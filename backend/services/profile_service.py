"""Shared Career Profile aggregation, completion scoring, and schema error handling."""

from __future__ import annotations

from typing import Any

from services.supabase_service import get_secret_client
from utils.errors import ServiceUnavailableError


def handle_supabase_error(exc: Exception) -> None:
    """Translate Supabase schema/permission errors into clear 503 responses."""
    msg = str(exc)
    lower = msg.lower()
    if "pgrst205" in lower or "schema cache" in lower or "does not exist" in lower:
        raise ServiceUnavailableError(
            "Database schema is not initialized yet. Execute the Supabase SQL schema and migrations first."
        ) from exc
    if "permission denied" in lower or "42501" in lower:
        raise ServiceUnavailableError(
            "Database role permissions are incomplete. Execute migration 003_grants_and_permissions.sql in Supabase."
        ) from exc
    raise exc


def compute_profile_completion(
    profile: dict[str, Any],
    experience: list[dict[str, Any]],
    education: list[dict[str, Any]],
    skills: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    certifications: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute transparent profile completion percentage and actionable suggestions."""
    checks = [
        {
            "key": "personal_details",
            "label": "Personal details & location",
            "completed": bool(
                (profile.get("full_name") or "").strip()
                and ((profile.get("professional_title") or "").strip() or (profile.get("country") or "").strip())
            ),
            "action_href": "/profile.html#personal",
            "suggestion": "Add your professional title and country/city so documents include complete contact headers.",
        },
        {
            "key": "professional_summary",
            "label": "Professional summary & objective",
            "completed": bool((profile.get("professional_summary") or "").strip()),
            "action_href": "/profile.html#summary",
            "suggestion": "Write a concise professional summary describing your core strengths and target roles.",
        },
        {
            "key": "experience",
            "label": "Work experience",
            "completed": len(experience) > 0,
            "action_href": "/profile.html#experience",
            "suggestion": "Add at least one work, internship, or volunteering experience with responsibilities.",
        },
        {
            "key": "education",
            "label": "Education history",
            "completed": len(education) > 0,
            "action_href": "/profile.html#education",
            "suggestion": "Add your academic qualifications, degree, or training background.",
        },
        {
            "key": "skills",
            "label": "Confirmed skills",
            "completed": len(skills) >= 3,
            "action_href": "/profile.html#skills",
            "suggestion": "Add at least 3 technical, soft, or tool skills for accurate job compatibility matching.",
        },
        {
            "key": "projects",
            "label": "Projects or certifications",
            "completed": len(projects) > 0 or len(certifications) > 0,
            "action_href": "/profile.html#projects",
            "suggestion": "Add a project or certification to strengthen evidence for tailored CVs and interviews.",
        },
    ]

    completed_count = sum(1 for item in checks if item["completed"])
    total = len(checks)
    percentage = int(round((completed_count / total) * 100)) if total else 0

    return {
        "percentage": percentage,
        "completed_count": completed_count,
        "total_sections": total,
        "sections": checks,
        "suggestions": [
            {"key": item["key"], "label": item["label"], "suggestion": item["suggestion"], "href": item["action_href"]}
            for item in checks
            if not item["completed"]
        ],
    }


def get_full_profile(user_id: str) -> dict[str, Any]:
    """Fetch complete confirmed career profile and computed completion metrics for a user."""
    client = get_secret_client()
    try:
        profile_res = client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
        profile = (profile_res.data or [{}])[0]

        exp_res = (
            client.table("career_experience")
            .select("*")
            .eq("user_id", user_id)
            .order("is_current", desc=True)
            .order("start_date", desc=True)
            .execute()
        )
        edu_res = (
            client.table("education")
            .select("*")
            .eq("user_id", user_id)
            .order("end_date", desc=True)
            .execute()
        )
        skills_res = (
            client.table("skills")
            .select("*")
            .eq("user_id", user_id)
            .order("skill_category")
            .order("skill_name")
            .execute()
        )
        projects_res = (
            client.table("projects")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        certs_res = (
            client.table("certifications")
            .select("*")
            .eq("user_id", user_id)
            .order("issue_date", desc=True)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    experience = exp_res.data or []
    education = edu_res.data or []
    skills = skills_res.data or []
    projects = projects_res.data or []
    certifications = certs_res.data or []

    completion = compute_profile_completion(
        profile, experience, education, skills, projects, certifications
    )

    return {
        "profile": profile,
        "experience": experience,
        "education": education,
        "skills": skills,
        "projects": projects,
        "certifications": certifications,
        "completion": completion,
    }


def record_notification(user_id: str, notification_type: str, message: str) -> None:
    """Create a user-facing activity notification record cleanly (non-fatal on failure)."""
    try:
        get_secret_client().table("notifications").insert(
            {
                "user_id": user_id,
                "notification_type": notification_type,
                "message": message[:500],
                "is_read": False,
            }
        ).execute()
    except Exception:  # noqa: BLE001
        pass
