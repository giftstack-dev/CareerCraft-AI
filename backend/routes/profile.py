"""Career Profile & Onboarding CRUD Blueprint."""

from __future__ import annotations

from datetime import date
from typing import Any

from flask import Blueprint, g, request

from services.profile_service import get_full_profile, handle_supabase_error, record_notification
from services.supabase_service import get_secret_client
from utils.auth import require_auth
from utils.errors import NotFoundError, ValidationError, success_response
from utils.validators import is_safe_http_url, is_valid_uuid

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")

VALID_SKILL_CATEGORIES = ("technical", "soft", "tool", "industry", "language")


def _clean_text(value: Any, max_len: int = 500) -> str:
    return str(value or "").strip()[:max_len]


def _clean_optional_text(value: Any, max_len: int = 1000) -> str | None:
    text = str(value or "").strip()[:max_len]
    return text or None


def _parse_optional_date(value: Any, field_name: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        date.fromisoformat(raw)
        return raw
    except ValueError as exc:
        raise ValidationError(f"Invalid date format for {field_name}. Use YYYY-MM-DD.") from exc


def _clean_string_list(value: Any, max_items: int = 25, item_max: int = 400) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = [line.strip("-• \t") for line in value.splitlines() if line.strip()]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        raise ValidationError("Expected a list of text items.")
    return [item[:item_max] for item in items[:max_items]]


def _clean_professional_links(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError("Professional links must be a list.")
    cleaned: list[dict[str, str]] = []
    for item in value[:12]:
        if isinstance(item, dict):
            label = _clean_text(item.get("label") or item.get("platform") or "Link", 60)
            url = _clean_text(item.get("url"), 300)
            if url:
                if not is_safe_http_url(url):
                    raise ValidationError(f"Link '{label}' must use an http:// or https:// URL.")
                cleaned.append({"label": label or "Link", "url": url})
    return cleaned


def _clean_languages(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError("Languages must be a list.")
    cleaned: list[dict[str, str]] = []
    for item in value[:15]:
        if isinstance(item, dict):
            name = _clean_text(item.get("language") or item.get("name"), 80)
            prof = _clean_text(item.get("proficiency") or "Working proficiency", 80)
            if name:
                cleaned.append({"language": name, "proficiency": prof})
        elif isinstance(item, str) and item.strip():
            cleaned.append({"language": item.strip()[:80], "proficiency": "Working proficiency"})
    return cleaned


@profile_bp.get("")
@require_auth(require_verified_email=True)
def get_profile():
    """Return complete career profile, sub-records, and completion breakdown."""
    data = get_full_profile(g.current_user.user_id)
    return success_response(data=data, message="Career profile loaded.")


@profile_bp.put("")
@require_auth(require_verified_email=True)
def update_profile():
    """Update core personal details, summary, links, languages, objective, or onboarding progress."""
    payload = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}

    if "full_name" in payload:
        name = _clean_text(payload.get("full_name"), 120)
        if not name or len(name) < 2:
            raise ValidationError("Full name must be at least 2 characters.")
        updates["full_name"] = name

    for field, max_len in (
        ("phone", 40),
        ("country", 80),
        ("city", 80),
        ("professional_title", 140),
        ("professional_summary", 3000),
        ("career_objective", 1500),
    ):
        if field in payload:
            updates[field] = _clean_optional_text(payload.get(field), max_len)

    if "portfolio_url" in payload:
        portfolio = _clean_optional_text(payload.get("portfolio_url"), 300)
        if portfolio and not is_safe_http_url(portfolio):
            raise ValidationError("Portfolio URL must start with http:// or https://.")
        updates["portfolio_url"] = portfolio

    if "professional_links" in payload:
        updates["professional_links"] = _clean_professional_links(payload.get("professional_links"))

    if "languages" in payload:
        updates["languages"] = _clean_languages(payload.get("languages"))

    if "onboarding_status" in payload:
        status = _clean_text(payload.get("onboarding_status"), 40)
        if status not in ("not_started", "in_progress", "completed", "skipped"):
            raise ValidationError("Invalid onboarding_status value.")
        updates["onboarding_status"] = status

    if "onboarding_step" in payload:
        try:
            step = int(payload.get("onboarding_step"))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Invalid onboarding_step value.") from exc
        if step < 1 or step > 7:
            raise ValidationError("onboarding_step must be between 1 and 7.")
        updates["onboarding_step"] = step

    if not updates:
        raise ValidationError("No valid profile fields provided.")

    user_id = g.current_user.user_id
    try:
        get_secret_client().table("profiles").update(updates).eq("id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    data = get_full_profile(user_id)
    return success_response(data=data, message="Career profile updated.")


@profile_bp.post("/experience")
@require_auth(require_verified_email=True)
def create_experience():
    payload = request.get_json(silent=True) or {}
    employer = _clean_text(payload.get("employer"), 140)
    job_title = _clean_text(payload.get("job_title"), 140)
    start_date = _parse_optional_date(payload.get("start_date"), "start_date")
    is_current = bool(payload.get("is_current", False))
    end_date = None if is_current else _parse_optional_date(payload.get("end_date"), "end_date")

    if not employer or not job_title or not start_date:
        raise ValidationError("Employer, job title, and start date are required.")
    if end_date and end_date < start_date:
        raise ValidationError("End date cannot be earlier than start date.")

    row = {
        "user_id": g.current_user.user_id,
        "employer": employer,
        "job_title": job_title,
        "start_date": start_date,
        "end_date": end_date,
        "is_current": is_current,
        "responsibilities": _clean_string_list(payload.get("responsibilities")),
        "achievements": _clean_string_list(payload.get("achievements")),
    }
    try:
        res = get_secret_client().table("career_experience").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"item": (res.data or [{}])[0]}, message="Work experience added.", status_code=201)


@profile_bp.route("/experience/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def mutate_experience(record_id: str):
    if not is_valid_uuid(record_id):
        raise ValidationError("Invalid experience record ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("career_experience").delete().eq("id", record_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Experience record not found.")
        return success_response(data={"deleted_id": record_id}, message="Work experience removed.")

    payload = request.get_json(silent=True) or {}
    employer = _clean_text(payload.get("employer"), 140)
    job_title = _clean_text(payload.get("job_title"), 140)
    start_date = _parse_optional_date(payload.get("start_date"), "start_date")
    is_current = bool(payload.get("is_current", False))
    end_date = None if is_current else _parse_optional_date(payload.get("end_date"), "end_date")
    if not employer or not job_title or not start_date:
        raise ValidationError("Employer, job title, and start date are required.")
    if end_date and end_date < start_date:
        raise ValidationError("End date cannot be earlier than start date.")

    updates = {
        "employer": employer,
        "job_title": job_title,
        "start_date": start_date,
        "end_date": end_date,
        "is_current": is_current,
        "responsibilities": _clean_string_list(payload.get("responsibilities")),
        "achievements": _clean_string_list(payload.get("achievements")),
    }
    try:
        res = client.table("career_experience").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Experience record not found.")
    return success_response(data={"item": res.data[0]}, message="Work experience updated.")


@profile_bp.post("/education")
@require_auth(require_verified_email=True)
def create_education():
    payload = request.get_json(silent=True) or {}
    institution = _clean_text(payload.get("institution"), 160)
    qualification = _clean_text(payload.get("qualification"), 160)
    if not institution or not qualification:
        raise ValidationError("Institution and qualification are required.")

    start_date = _parse_optional_date(payload.get("start_date"), "start_date")
    end_date = _parse_optional_date(payload.get("end_date"), "end_date")
    if start_date and end_date and end_date < start_date:
        raise ValidationError("End date cannot be earlier than start date.")

    row = {
        "user_id": g.current_user.user_id,
        "institution": institution,
        "qualification": qualification,
        "field_of_study": _clean_optional_text(payload.get("field_of_study"), 160),
        "start_date": start_date,
        "end_date": end_date,
        "achievements": _clean_optional_text(payload.get("achievements"), 1000),
    }
    try:
        res = get_secret_client().table("education").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"item": (res.data or [{}])[0]}, message="Education record added.", status_code=201)


@profile_bp.route("/education/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def mutate_education(record_id: str):
    if not is_valid_uuid(record_id):
        raise ValidationError("Invalid education record ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("education").delete().eq("id", record_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Education record not found.")
        return success_response(data={"deleted_id": record_id}, message="Education record removed.")

    payload = request.get_json(silent=True) or {}
    institution = _clean_text(payload.get("institution"), 160)
    qualification = _clean_text(payload.get("qualification"), 160)
    if not institution or not qualification:
        raise ValidationError("Institution and qualification are required.")
    start_date = _parse_optional_date(payload.get("start_date"), "start_date")
    end_date = _parse_optional_date(payload.get("end_date"), "end_date")
    if start_date and end_date and end_date < start_date:
        raise ValidationError("End date cannot be earlier than start date.")

    updates = {
        "institution": institution,
        "qualification": qualification,
        "field_of_study": _clean_optional_text(payload.get("field_of_study"), 160),
        "start_date": start_date,
        "end_date": end_date,
        "achievements": _clean_optional_text(payload.get("achievements"), 1000),
    }
    try:
        res = client.table("education").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Education record not found.")
    return success_response(data={"item": res.data[0]}, message="Education record updated.")


@profile_bp.post("/skills")
@require_auth(require_verified_email=True)
def create_skill():
    payload = request.get_json(silent=True) or {}
    skill_name = _clean_text(payload.get("skill_name"), 100)
    skill_category = _clean_text(payload.get("skill_category") or "technical", 30).lower()
    if not skill_name:
        raise ValidationError("Skill name is required.")
    if skill_category not in VALID_SKILL_CATEGORIES:
        raise ValidationError(f"Skill category must be one of: {', '.join(VALID_SKILL_CATEGORIES)}.")

    row = {
        "user_id": g.current_user.user_id,
        "skill_name": skill_name,
        "skill_category": skill_category,
        "proficiency": _clean_optional_text(payload.get("proficiency"), 60),
    }
    try:
        res = (
            get_secret_client()
            .table("skills")
            .upsert(row, on_conflict="user_id,skill_name,skill_category")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"item": (res.data or [{}])[0]}, message="Skill saved.", status_code=201)


@profile_bp.route("/skills/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def mutate_skill(record_id: str):
    if not is_valid_uuid(record_id):
        raise ValidationError("Invalid skill record ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("skills").delete().eq("id", record_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Skill not found.")
        return success_response(data={"deleted_id": record_id}, message="Skill removed.")

    payload = request.get_json(silent=True) or {}
    skill_name = _clean_text(payload.get("skill_name"), 100)
    skill_category = _clean_text(payload.get("skill_category") or "technical", 30).lower()
    if not skill_name:
        raise ValidationError("Skill name is required.")
    if skill_category not in VALID_SKILL_CATEGORIES:
        raise ValidationError("Invalid skill category.")

    updates = {
        "skill_name": skill_name,
        "skill_category": skill_category,
        "proficiency": _clean_optional_text(payload.get("proficiency"), 60),
    }
    try:
        res = client.table("skills").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Skill not found.")
    return success_response(data={"item": res.data[0]}, message="Skill updated.")


@profile_bp.post("/projects")
@require_auth(require_verified_email=True)
def create_project():
    payload = request.get_json(silent=True) or {}
    project_title = _clean_text(payload.get("project_title"), 160)
    description = _clean_text(payload.get("description"), 2000)
    if not project_title or not description:
        raise ValidationError("Project title and description are required.")
    project_url = _clean_optional_text(payload.get("project_url"), 300)
    if project_url and not is_safe_http_url(project_url):
        raise ValidationError("Project URL must use http:// or https://.")

    row = {
        "user_id": g.current_user.user_id,
        "project_title": project_title,
        "description": description,
        "personal_contribution": _clean_optional_text(payload.get("personal_contribution"), 1500),
        "tools": _clean_string_list(payload.get("tools"), max_items=20, item_max=60),
        "project_url": project_url,
    }
    try:
        res = get_secret_client().table("projects").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"item": (res.data or [{}])[0]}, message="Project added.", status_code=201)


@profile_bp.route("/projects/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def mutate_project(record_id: str):
    if not is_valid_uuid(record_id):
        raise ValidationError("Invalid project record ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("projects").delete().eq("id", record_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Project not found.")
        return success_response(data={"deleted_id": record_id}, message="Project removed.")

    payload = request.get_json(silent=True) or {}
    project_title = _clean_text(payload.get("project_title"), 160)
    description = _clean_text(payload.get("description"), 2000)
    if not project_title or not description:
        raise ValidationError("Project title and description are required.")
    project_url = _clean_optional_text(payload.get("project_url"), 300)
    if project_url and not is_safe_http_url(project_url):
        raise ValidationError("Project URL must use http:// or https://.")

    updates = {
        "project_title": project_title,
        "description": description,
        "personal_contribution": _clean_optional_text(payload.get("personal_contribution"), 1500),
        "tools": _clean_string_list(payload.get("tools"), max_items=20, item_max=60),
        "project_url": project_url,
    }
    try:
        res = client.table("projects").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Project not found.")
    return success_response(data={"item": res.data[0]}, message="Project updated.")


@profile_bp.post("/certifications")
@require_auth(require_verified_email=True)
def create_certification():
    payload = request.get_json(silent=True) or {}
    name = _clean_text(payload.get("certification_name"), 160)
    org = _clean_text(payload.get("issuing_organisation"), 160)
    if not name or not org:
        raise ValidationError("Certification name and issuing organisation are required.")
    issue_date = _parse_optional_date(payload.get("issue_date"), "issue_date")
    cred_url = _clean_optional_text(payload.get("credential_url"), 300)
    if cred_url and not is_safe_http_url(cred_url):
        raise ValidationError("Credential URL must use http:// or https://.")

    row = {
        "user_id": g.current_user.user_id,
        "certification_name": name,
        "issuing_organisation": org,
        "issue_date": issue_date,
        "credential_url": cred_url,
    }
    try:
        res = get_secret_client().table("certifications").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"item": (res.data or [{}])[0]}, message="Certification added.", status_code=201)


@profile_bp.route("/certifications/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def mutate_certification(record_id: str):
    if not is_valid_uuid(record_id):
        raise ValidationError("Invalid certification record ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("certifications").delete().eq("id", record_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Certification not found.")
        return success_response(data={"deleted_id": record_id}, message="Certification removed.")

    payload = request.get_json(silent=True) or {}
    name = _clean_text(payload.get("certification_name"), 160)
    org = _clean_text(payload.get("issuing_organisation"), 160)
    if not name or not org:
        raise ValidationError("Certification name and issuing organisation are required.")
    issue_date = _parse_optional_date(payload.get("issue_date"), "issue_date")
    cred_url = _clean_optional_text(payload.get("credential_url"), 300)
    if cred_url and not is_safe_http_url(cred_url):
        raise ValidationError("Credential URL must use http:// or https://.")

    updates = {
        "certification_name": name,
        "issuing_organisation": org,
        "issue_date": issue_date,
        "credential_url": cred_url,
    }
    try:
        res = client.table("certifications").update(updates).eq("id", record_id).eq("user_id", user_id).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Certification not found.")
    return success_response(data={"item": res.data[0]}, message="Certification updated.")
