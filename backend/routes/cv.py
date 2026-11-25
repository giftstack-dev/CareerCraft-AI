"""CV Upload, AI Extraction, Safe Confirmation Merging & History Blueprint."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date
from typing import Any

from flask import Blueprint, current_app, g, request

from services.cv_parser_service import (
    detect_and_validate_cv_file,
    extract_text_from_cv,
    parse_cv_text_with_gemini,
)
from services.profile_service import handle_supabase_error, record_notification
from services.supabase_service import get_user_client
from services.usage_service import enforce_daily_ai_quota, record_usage
from utils.auth import require_auth
from utils.errors import NotFoundError, ServiceUnavailableError, ValidationError, success_response
from utils.security import sanitize_filename, validate_user_storage_path
from utils.validators import is_safe_http_url, is_valid_uuid

logger = logging.getLogger(__name__)
cv_bp = Blueprint("cv", __name__, url_prefix="/api/cv")
CV_BUCKET = "uploaded-cvs"
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
YEAR_RE = re.compile(r"^(\d{4})$")


def _normalize_extracted_date(raw: Any) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if ISO_DATE_RE.match(text):
        try:
            date.fromisoformat(text)
            return text
        except ValueError:
            return None
    ym = YEAR_MONTH_RE.match(text)
    if ym:
        candidate = f"{ym.group(1)}-{ym.group(2)}-01"
        try:
            date.fromisoformat(candidate)
            return candidate
        except ValueError:
            return None
    yr = YEAR_RE.match(text)
    if yr:
        return f"{yr.group(1)}-01-01"
    return None


@cv_bp.get("")
@require_auth(require_verified_email=True)
def list_cvs():
    user_id = g.current_user.user_id
    try:
        res = (
            get_user_client()
            .table("uploaded_cvs")
            .select("id, original_filename, mime_type, file_size_bytes, parsing_status, confirmation_status, extracted_data, created_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"items": res.data or []}, message="Uploaded CVs loaded.")


@cv_bp.get("/<cv_id>")
@require_auth(require_verified_email=True)
def get_cv(cv_id: str):
    if not is_valid_uuid(cv_id):
        raise ValidationError("Invalid CV ID.")
    user_id = g.current_user.user_id
    try:
        res = (
            get_user_client()
            .table("uploaded_cvs")
            .select("*")
            .eq("id", cv_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Uploaded CV not found.")
    return success_response(data={"item": res.data[0]}, message="CV details loaded.")


@cv_bp.post("/upload")
@require_auth(require_verified_email=True)
def upload_cv():
    """Upload PDF/DOCX CV to private Supabase Storage, validate readability, and save metadata."""
    if "file" not in request.files:
        raise ValidationError("No CV file was provided in the request.")

    file_storage = request.files["file"]
    original_filename = file_storage.filename or ""
    file_bytes = file_storage.read()
    cfg = current_app.config["APP_CONFIG"]

    mime_type = detect_and_validate_cv_file(
        original_filename, file_bytes, max_mb=cfg.MAX_UPLOAD_SIZE_MB
    )
    extraction = extract_text_from_cv(file_bytes, mime_type)

    cv_id = str(uuid.uuid4())
    user_id = g.current_user.user_id
    safe_name = sanitize_filename(original_filename, fallback="resume.pdf")
    storage_path = f"{user_id}/{cv_id}/{safe_name}"

    if not validate_user_storage_path(storage_path, user_id):
        raise ValidationError("Invalid storage path.")

    client = get_user_client()
    try:
        client.storage.from_(CV_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
    except Exception as exc:  # noqa: BLE001
        raise ServiceUnavailableError(
            "Unable to upload CV to private Supabase Storage. Verify bucket 'uploaded-cvs' exists in Supabase."
        ) from exc

    row = {
        "id": cv_id,
        "user_id": user_id,
        "original_filename": safe_name,
        "storage_path": storage_path,
        "mime_type": mime_type,
        "file_size_bytes": len(file_bytes),
        "parsing_status": extraction["status"],
        "extracted_data": {
            "raw_text_preview": extraction["text"][:4000],
            "page_count": extraction["page_count"],
            "readable": extraction["readable"],
            "reason": extraction["reason"],
        },
        "confirmation_status": "pending_review" if extraction["readable"] else "discarded",
    }

    try:
        inserted = client.table("uploaded_cvs").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    item = (inserted.data or [row])[0]
    record_notification(user_id, "cv_upload", f"Uploaded CV file '{safe_name}'.")
    return success_response(
        data={
            "item": item,
            "readable": extraction["readable"],
            "reason": extraction["reason"],
        },
        message="CV uploaded successfully." if extraction["readable"] else extraction["reason"],
        status_code=201,
    )


@cv_bp.post("/parse")
@require_auth(require_verified_email=True)
def parse_cv():
    """Extract structured sections from a previously uploaded CV using Gemini (without overwriting profile)."""
    payload = request.get_json(silent=True) or {}
    cv_id = str(payload.get("cv_id", "")).strip()
    if not is_valid_uuid(cv_id):
        raise ValidationError("Valid cv_id is required.")

    user_id = g.current_user.user_id
    client = get_user_client()
    try:
        res = (
            client.table("uploaded_cvs")
            .select("*")
            .eq("id", cv_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    if not res.data:
        raise NotFoundError("Uploaded CV not found.")

    cv_row = res.data[0]
    enforce_daily_ai_quota(user_id)

    storage_path = str(cv_row.get("storage_path") or "")
    if not validate_user_storage_path(storage_path, user_id):
        raise ValidationError("Invalid stored CV path.")

    try:
        file_bytes = client.storage.from_(CV_BUCKET).download(storage_path)
    except Exception as exc:  # noqa: BLE001
        raise ServiceUnavailableError("Could not download stored CV file from private storage.") from exc

    extraction = extract_text_from_cv(file_bytes, cv_row["mime_type"])
    if not extraction["readable"]:
        client.table("uploaded_cvs").update(
            {
                "parsing_status": extraction["status"],
                "extracted_data": {
                    "readable": False,
                    "reason": extraction["reason"],
                },
            }
        ).eq("id", cv_id).eq("user_id", user_id).execute()
        raise ValidationError(extraction["reason"])

    cfg = current_app.config["APP_CONFIG"]
    client.table("uploaded_cvs").update({"parsing_status": "extracting"}).eq("id", cv_id).eq("user_id", user_id).execute()

    try:
        parsed, usage = parse_cv_text_with_gemini(extraction["text"])
        parsed_bundle = {
            "readable": True,
            "page_count": extraction["page_count"],
            "parsed": parsed,
        }
        updated = (
            client.table("uploaded_cvs")
            .update(
                {
                    "parsing_status": "parsed",
                    "extracted_data": parsed_bundle,
                    "confirmation_status": "pending_review",
                }
            )
            .eq("id", cv_id)
            .eq("user_id", user_id)
            .execute()
        )
        record_usage(
            user_id=user_id,
            operation_type="cv_parse",
            ai_model=cfg.GEMINI_MODEL,
            request_status="success",
            prompt_tokens=getattr(usage, "prompt_token_count", None),
            completion_tokens=getattr(usage, "candidates_token_count", None),
            total_tokens=getattr(usage, "total_token_count", None),
        )
    except Exception:
        client.table("uploaded_cvs").update({"parsing_status": "failed"}).eq("id", cv_id).eq("user_id", user_id).execute()
        record_usage(
            user_id=user_id,
            operation_type="cv_parse",
            ai_model=cfg.GEMINI_MODEL,
            request_status="failed",
        )
        raise

    return success_response(
        data={"item": (updated.data or [cv_row])[0], "parsed": parsed},
        message="CV parsed successfully. Review the extracted details before merging into your career profile.",
    )


@cv_bp.post("/confirm")
@require_auth(require_verified_email=True)
def confirm_cv_merge():
    """Safely merge user-confirmed extracted CV sections without overwriting existing confirmed values unless selected."""
    payload = request.get_json(silent=True) or {}
    cv_id = str(payload.get("cv_id", "")).strip()
    if not is_valid_uuid(cv_id):
        raise ValidationError("Valid cv_id is required.")

    user_id = g.current_user.user_id
    client = get_user_client()
    try:
        cv_res = client.table("uploaded_cvs").select("*").eq("id", cv_id).eq("user_id", user_id).limit(1).execute()
        if not cv_res.data:
            raise NotFoundError("Uploaded CV not found.")

        profile_res = client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
        existing_profile = (profile_res.data or [{}])[0]

        overwrite_existing_summary = bool(payload.get("overwrite_existing_fields", False))
        merged_counts = {"experience": 0, "education": 0, "skills": 0, "projects": 0, "certifications": 0}

        # 1. Personal details & summary (fill empty fields unless explicit overwrite checked)
        personal = payload.get("personal_details") or {}
        profile_updates: dict[str, Any] = {}
        for key in ("full_name", "phone", "country", "city", "professional_title"):
            val = str(personal.get(key) or "").strip()
            if val and (overwrite_existing_summary or not (existing_profile.get(key) or "").strip()):
                profile_updates[key] = val[:160]

        portfolio = str(personal.get("portfolio_url") or "").strip()
        if portfolio and is_safe_http_url(portfolio):
            if overwrite_existing_summary or not (existing_profile.get("portfolio_url") or "").strip():
                profile_updates["portfolio_url"] = portfolio[:300]

        summary = str(payload.get("professional_summary") or "").strip()
        if summary and (overwrite_existing_summary or not (existing_profile.get("professional_summary") or "").strip()):
            profile_updates["professional_summary"] = summary[:3000]

        objective = str(payload.get("career_objective") or "").strip()
        if objective and (overwrite_existing_summary or not (existing_profile.get("career_objective") or "").strip()):
            profile_updates["career_objective"] = objective[:1500]

        langs = payload.get("languages")
        if isinstance(langs, list) and langs:
            existing_langs = existing_profile.get("languages") or []
            seen_langs = {str(item.get("language") or "").lower() for item in existing_langs if isinstance(item, dict)}
            new_langs = list(existing_langs)
            for lang_item in langs[:10]:
                name = str(lang_item.get("language") if isinstance(lang_item, dict) else lang_item).strip()
                if name and name.lower() not in seen_langs:
                    seen_langs.add(name.lower())
                    new_langs.append({"language": name[:80], "proficiency": "Working proficiency"})
            if len(new_langs) > len(existing_langs):
                profile_updates["languages"] = new_langs

        if profile_updates:
            client.table("profiles").update(profile_updates).eq("id", user_id).execute()

        # 2. Experience records
        for exp in (payload.get("experience") or [])[:20]:
            employer = str(exp.get("employer") or "").strip()[:140]
            title = str(exp.get("job_title") or "").strip()[:140]
            start_dt = _normalize_extracted_date(exp.get("start_date"))
            if not employer or not title or not start_dt:
                continue
            is_curr = bool(exp.get("is_current", False))
            end_dt = None if is_curr else _normalize_extracted_date(exp.get("end_date"))
            if end_dt and end_dt < start_dt:
                end_dt = None
            client.table("career_experience").insert(
                {
                    "user_id": user_id,
                    "employer": employer,
                    "job_title": title,
                    "start_date": start_dt,
                    "end_date": end_dt,
                    "is_current": is_curr,
                    "responsibilities": [str(r).strip()[:400] for r in (exp.get("responsibilities") or []) if str(r).strip()][:15],
                    "achievements": [str(a).strip()[:400] for a in (exp.get("achievements") or []) if str(a).strip()][:15],
                }
            ).execute()
            merged_counts["experience"] += 1

        # 3. Education records
        for edu in (payload.get("education") or [])[:15]:
            inst = str(edu.get("institution") or "").strip()[:160]
            qual = str(edu.get("qualification") or "").strip()[:160]
            if not inst or not qual:
                continue
            start_dt = _normalize_extracted_date(edu.get("start_date"))
            end_dt = _normalize_extracted_date(edu.get("end_date"))
            if start_dt and end_dt and end_dt < start_dt:
                end_dt = None
            client.table("education").insert(
                {
                    "user_id": user_id,
                    "institution": inst,
                    "qualification": qual,
                    "field_of_study": str(edu.get("field_of_study") or "").strip()[:160] or None,
                    "start_date": start_dt,
                    "end_date": end_dt,
                    "achievements": str(edu.get("achievements") or "").strip()[:1000] or None,
                }
            ).execute()
            merged_counts["education"] += 1

        # 4. Skills (upsert deduplicated)
        for sk in (payload.get("skills") or [])[:50]:
            name = str(sk.get("skill_name") if isinstance(sk, dict) else sk).strip()[:100]
            cat = str(sk.get("skill_category") if isinstance(sk, dict) else "technical").strip().lower()
            if cat not in ("technical", "soft", "tool", "industry", "language"):
                cat = "technical"
            if name:
                client.table("skills").upsert(
                    {"user_id": user_id, "skill_name": name, "skill_category": cat},
                    on_conflict="user_id,skill_name,skill_category",
                ).execute()
                merged_counts["skills"] += 1

        # 5. Projects
        for proj in (payload.get("projects") or [])[:15]:
            title = str(proj.get("project_title") or "").strip()[:160]
            desc = str(proj.get("description") or "").strip()[:2000]
            if not title or not desc:
                continue
            purl = str(proj.get("project_url") or "").strip()
            client.table("projects").insert(
                {
                    "user_id": user_id,
                    "project_title": title,
                    "description": desc,
                    "personal_contribution": str(proj.get("personal_contribution") or "").strip()[:1500] or None,
                    "tools": [str(t).strip()[:60] for t in (proj.get("tools") or []) if str(t).strip()][:15],
                    "project_url": purl if is_safe_http_url(purl) else None,
                }
            ).execute()
            merged_counts["projects"] += 1

        # 6. Certifications
        for cert in (payload.get("certifications") or [])[:15]:
            cname = str(cert.get("certification_name") or "").strip()[:160]
            org = str(cert.get("issuing_organisation") or "").strip()[:160]
            if not cname or not org:
                continue
            curl = str(cert.get("credential_url") or "").strip()
            client.table("certifications").insert(
                {
                    "user_id": user_id,
                    "certification_name": cname,
                    "issuing_organisation": org,
                    "issue_date": _normalize_extracted_date(cert.get("issue_date")),
                    "credential_url": curl if is_safe_http_url(curl) else None,
                }
            ).execute()
            merged_counts["certifications"] += 1

        conf_status = "confirmed" if payload.get("mark_fully_confirmed", True) else "partially_confirmed"
        client.table("uploaded_cvs").update({"confirmation_status": conf_status}).eq("id", cv_id).eq("user_id", user_id).execute()
        record_notification(user_id, "cv_confirm", "Confirmed and merged extracted CV details into career profile.")
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(
        data={"merged_counts": merged_counts, "confirmation_status": conf_status},
        message="Confirmed CV items merged into your career profile.",
    )


@cv_bp.delete("/<cv_id>")
@require_auth(require_verified_email=True)
def delete_cv(cv_id: str):
    if not is_valid_uuid(cv_id):
        raise ValidationError("Invalid CV ID.")
    user_id = g.current_user.user_id
    client = get_user_client()
    try:
        res = client.table("uploaded_cvs").select("id, storage_path").eq("id", cv_id).eq("user_id", user_id).limit(1).execute()
        if not res.data:
            raise NotFoundError("Uploaded CV not found.")
        storage_path = str(res.data[0].get("storage_path") or "")
        if validate_user_storage_path(storage_path, user_id):
            try:
                client.storage.from_(CV_BUCKET).remove([storage_path])
            except Exception as exc:  # noqa: BLE001
                logger.warning("Storage deletion skipped/failed for CV %s: %s", cv_id, type(exc).__name__)
        client.table("uploaded_cvs").delete().eq("id", cv_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(data={"deleted_id": cv_id}, message="Uploaded CV deleted.")
