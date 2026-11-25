"""Authentication configuration, session verification, and profile initialization Blueprint."""

from __future__ import annotations

from flask import Blueprint, current_app, g, request

from services.supabase_service import get_secret_client
from utils.auth import require_auth
from utils.errors import ValidationError, success_response

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.get("/config")
def get_public_auth_config():
    """Return ONLY public Supabase runtime config (never secret keys)."""
    cfg = current_app.config["APP_CONFIG"]
    return success_response(
        data={
            "supabaseUrl": cfg.SUPABASE_URL if cfg.supabase_public_configured else "",
            "supabasePublishableKey": (
                cfg.SUPABASE_PUBLISHABLE_KEY if cfg.supabase_public_configured else ""
            ),
            "configured": cfg.supabase_public_configured,
        },
        message="Public authentication configuration loaded.",
    )


def _ensure_user_profile(user_id: str, email: str, full_name: str) -> dict:
    """Idempotently initialize and return the authenticated user's profile row."""
    client = get_secret_client()
    existing = (
        client.table("profiles")
        .select("id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = existing.data or []
    if rows:
        profile = rows[0]
        # Keep email/full_name synced if previously blank
        updates: dict[str, str] = {}
        if email and not profile.get("email"):
            updates["email"] = email
        if full_name and not profile.get("full_name"):
            updates["full_name"] = full_name
        if updates:
            updated = (
                client.table("profiles")
                .update(updates)
                .eq("id", user_id)
                .select("id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at")
                .execute()
            )
            if updated.data:
                return updated.data[0]
        return profile

    inserted = (
        client.table("profiles")
        .insert(
            {
                "id": user_id,
                "email": email,
                "full_name": full_name,
                "onboarding_status": "not_started",
                "onboarding_step": 1,
            }
        )
        .select("id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at")
        .execute()
    )
    return (inserted.data or [{}])[0]


@auth_bp.get("/me")
@require_auth(require_verified_email=True)
def get_authenticated_session():
    """Verify user access token, initialize profile if needed, and return session summary."""
    user = g.current_user
    profile = _ensure_user_profile(user.user_id, user.email, user.full_name)
    return success_response(
        data={
            "user": {
                "id": user.user_id,
                "email": user.email,
                "email_verified": user.email_verified,
                "full_name": profile.get("full_name") or user.full_name,
            },
            "profile": profile,
        },
        message="Authenticated session verified.",
    )


@auth_bp.post("/onboarding-status")
@require_auth(require_verified_email=True)
def update_onboarding_status():
    """Allow verified user to update onboarding completion or skip state."""
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("onboarding_status", "")).strip()
    if status not in ("not_started", "in_progress", "completed", "skipped"):
        raise ValidationError("Invalid onboarding status value.")

    user = g.current_user
    _ensure_user_profile(user.user_id, user.email, user.full_name)

    client = get_secret_client()
    updated = (
        client.table("profiles")
        .update({"onboarding_status": status})
        .eq("id", user.user_id)
        .select("id, full_name, email, onboarding_status, onboarding_step, updated_at")
        .execute()
    )
    profile = (updated.data or [{}])[0]
    return success_response(data={"profile": profile}, message="Onboarding status updated.")
