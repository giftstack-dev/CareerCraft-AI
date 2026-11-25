"""Private Job Application Tracker Blueprint."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from flask import Blueprint, g, request

from services.profile_service import handle_supabase_error, record_notification
from services.supabase_service import get_secret_client
from utils.auth import require_auth
from utils.errors import NotFoundError, ValidationError, success_response
from utils.validators import is_valid_uuid

applications_bp = Blueprint("applications", __name__, url_prefix="/api/applications")

APPLICATION_STATUSES = (
    "Saved",
    "Preparing",
    "Applied",
    "Interview",
    "Assessment",
    "Offer Received",
    "Not Selected",
)


def _parse_optional_date(raw: Any, field_name: str) -> str | None:
    val = str(raw or "").strip()
    if not val:
        return None
    try:
        date.fromisoformat(val)
        return val
    except ValueError as exc:
        raise ValidationError(f"Invalid date for {field_name}. Use YYYY-MM-DD.") from exc


def _parse_optional_datetime(raw: Any, field_name: str) -> str | None:
    val = str(raw or "").strip()
    if not val:
        return None
    normalized = val[:-1] + "+00:00" if val.endswith("Z") else val
    try:
        datetime.fromisoformat(normalized)
        return val
    except ValueError as exc:
        raise ValidationError(f"Invalid date/time for {field_name}.") from exc


def _validate_linked_job(client, user_id: str, job_id: str | None) -> str | None:
    if not job_id:
        return None
    if not is_valid_uuid(job_id):
        raise ValidationError("Invalid job_opportunity_id.")
    res = (
        client.table("job_opportunities")
        .select("id")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise NotFoundError("Linked job opportunity not found.")
    return job_id


def _sync_linked_documents(client, user_id: str, application_id: str, doc_ids: list[str]) -> None:
    valid_ids = [str(did).strip() for did in doc_ids if is_valid_uuid(str(did).strip())]
    # Clear previous links for this application first
    client.table("generated_documents").update({"application_id": None}).eq("user_id", user_id).eq(
        "application_id", application_id
    ).execute()
    # Attach selected user-owned documents
    for did in valid_ids[:20]:
        client.table("generated_documents").update({"application_id": application_id}).eq("id", did).eq(
            "user_id", user_id
        ).execute()


@applications_bp.get("")
@require_auth(require_verified_email=True)
def list_applications():
    user_id = g.current_user.user_id
    status_filter = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip().lower()
    client = get_secret_client()

    try:
        query = (
            client.table("applications")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
        )
        if status_filter in APPLICATION_STATUSES:
            query = query.eq("status", status_filter)
        apps_res = query.execute()

        docs_res = (
            client.table("generated_documents")
            .select("id, document_title, document_type, document_status, application_id")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    docs_by_app: dict[str, list[dict[str, Any]]] = {}
    for doc in docs_res.data or []:
        aid = doc.get("application_id")
        if aid:
            docs_by_app.setdefault(aid, []).append(doc)

    items = []
    for app_row in apps_res.data or []:
        if search:
            haystack = f"{app_row.get('company_name', '')} {app_row.get('job_title', '')} {app_row.get('notes', '')}".lower()
            if search not in haystack:
                continue
        row_copy = dict(app_row)
        row_copy["linked_documents"] = docs_by_app.get(app_row["id"], [])
        items.append(row_copy)

    return success_response(data={"items": items}, message="Applications loaded.")


@applications_bp.post("")
@require_auth(require_verified_email=True)
def create_application():
    payload = request.get_json(silent=True) or {}
    user_id = g.current_user.user_id
    company_name = str(payload.get("company_name") or "").strip()[:160]
    job_title = str(payload.get("job_title") or "").strip()[:160]
    if not company_name or not job_title:
        raise ValidationError("Company name and job title are required.")

    status = str(payload.get("status") or "Saved").strip()
    if status not in APPLICATION_STATUSES:
        raise ValidationError(f"Status must be one of: {', '.join(APPLICATION_STATUSES)}.")

    client = get_secret_client()
    try:
        job_id = _validate_linked_job(client, user_id, str(payload.get("job_opportunity_id") or "").strip() or None)
        row = {
            "user_id": user_id,
            "job_opportunity_id": job_id,
            "company_name": company_name,
            "job_title": job_title,
            "application_date": _parse_optional_date(payload.get("application_date"), "application_date"),
            "status": status,
            "notes": str(payload.get("notes") or "").strip()[:4000] or None,
            "interview_date": _parse_optional_datetime(payload.get("interview_date"), "interview_date"),
            "follow_up_date": _parse_optional_date(payload.get("follow_up_date"), "follow_up_date"),
        }
        res = client.table("applications").insert(row).execute()
        app_row = (res.data or [row])[0]

        doc_ids = payload.get("document_ids")
        if isinstance(doc_ids, list) and app_row.get("id"):
            _sync_linked_documents(client, user_id, app_row["id"], doc_ids)

        record_notification(user_id, "application", f"Added application record: {job_title} at {company_name}.")
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(data={"item": app_row}, message="Application record created.", status_code=201)


@applications_bp.route("/<application_id>", methods=["GET", "PUT", "DELETE"])
@require_auth(require_verified_email=True)
def application_detail(application_id: str):
    if not is_valid_uuid(application_id):
        raise ValidationError("Invalid application ID.")

    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("applications").delete().eq("id", application_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Application record not found.")
        return success_response(data={"deleted_id": application_id}, message="Application record deleted.")

    try:
        existing = (
            client.table("applications")
            .select("*")
            .eq("id", application_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise NotFoundError("Application record not found.")
        current_app_row = existing.data[0]
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    if request.method == "GET":
        try:
            docs_res = (
                client.table("generated_documents")
                .select("id, document_title, document_type, document_status, application_id")
                .eq("user_id", user_id)
                .eq("application_id", application_id)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        item = dict(current_app_row)
        item["linked_documents"] = docs_res.data or []
        return success_response(data={"item": item}, message="Application record loaded.")

    payload = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}

    if "company_name" in payload:
        company = str(payload.get("company_name") or "").strip()[:160]
        if not company:
            raise ValidationError("Company name cannot be empty.")
        updates["company_name"] = company

    if "job_title" in payload:
        title = str(payload.get("job_title") or "").strip()[:160]
        if not title:
            raise ValidationError("Job title cannot be empty.")
        updates["job_title"] = title

    if "status" in payload:
        status = str(payload.get("status") or "").strip()
        if status not in APPLICATION_STATUSES:
            raise ValidationError("Invalid application status.")
        updates["status"] = status

    if "application_date" in payload:
        updates["application_date"] = _parse_optional_date(payload.get("application_date"), "application_date")
    if "follow_up_date" in payload:
        updates["follow_up_date"] = _parse_optional_date(payload.get("follow_up_date"), "follow_up_date")
    if "interview_date" in payload:
        updates["interview_date"] = _parse_optional_datetime(payload.get("interview_date"), "interview_date")
    if "notes" in payload:
        updates["notes"] = str(payload.get("notes") or "").strip()[:4000] or None

    try:
        if "job_opportunity_id" in payload:
            updates["job_opportunity_id"] = _validate_linked_job(
                client, user_id, str(payload.get("job_opportunity_id") or "").strip() or None
            )

        if updates:
            res = (
                client.table("applications")
                .update(updates)
                .eq("id", application_id)
                .eq("user_id", user_id)
                .execute()
            )
            current_app_row = (res.data or [current_app_row])[0]

        if "document_ids" in payload and isinstance(payload.get("document_ids"), list):
            _sync_linked_documents(client, user_id, application_id, payload["document_ids"])

        docs_res = (
            client.table("generated_documents")
            .select("id, document_title, document_type, document_status, application_id")
            .eq("user_id", user_id)
            .eq("application_id", application_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    item = dict(current_app_row)
    item["linked_documents"] = docs_res.data or []
    return success_response(data={"item": item}, message="Application record updated.")
