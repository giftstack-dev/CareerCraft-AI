"""Authentication configuration, session verification, and profile initialization Blueprint."""

from __future__ import annotations

import logging
from flask import Blueprint, current_app, g, request

from services.supabase_service import (
    classify_supabase_exception,
    get_secret_client,
    get_user_client,
)
from utils.auth import require_auth
from utils.errors import ServiceUnavailableError, ValidationError, success_response

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

PROFILE_SELECT_COLS = (
    "id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at"
)


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
            "providers": {
                "emailPassword": True,
                "googleOAuth": True,
            },
        },
        message="Public authentication configuration loaded.",
    )


def _format_profile_summary(
    row: dict | None,
    fallback_id: str,
    fallback_email: str,
    fallback_name: str,
) -> dict:
    row = row or {}
    return {
        "id": row.get("id") or fallback_id,
        "full_name": row.get("full_name") if row.get("full_name") is not None else fallback_name,
        "email": row.get("email") if row.get("email") is not None else fallback_email,
        "onboarding_status": row.get("onboarding_status") or "not_started",
        "onboarding_step": int(row.get("onboarding_step") or 1),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_user_profile(user_id: str, email: str, full_name: str) -> dict:
    """Idempotently initialize and return the verified user's profile row under RLS."""
    client = get_user_client()
    try:
        existing = (
            client.table("profiles")
            .select(PROFILE_SELECT_COLS)
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        classify_supabase_exception(exc, operation="profile lookup")

    rows = existing.data or []
    if rows:
        profile = rows[0]
        updates: dict[str, str] = {}
        if email and not profile.get("email"):
            updates["email"] = email
        if full_name and not profile.get("full_name"):
            updates["full_name"] = full_name
        if updates:
            try:
                updated = client.table("profiles").update(updates).eq("id", user_id).execute()
                if updated.data:
                    return _format_profile_summary(updated.data[0], user_id, email, full_name)
                refreshed = (
                    client.table("profiles").select(PROFILE_SELECT_COLS).eq("id", user_id).limit(1).execute()
                )
                if refreshed.data:
                    return _format_profile_summary(refreshed.data[0], user_id, email, full_name)
            except Exception as exc:  # noqa: BLE001
                classify_supabase_exception(exc, operation="profile synchronization")
        return _format_profile_summary(profile, user_id, email, full_name)

    new_profile_payload = {
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "onboarding_status": "not_started",
        "onboarding_step": 1,
    }

    try:
        inserted = client.table("profiles").insert(new_profile_payload).execute()
        if inserted.data:
            logger.info("Initialized new profile under user RLS for user_id=%s", user_id)
            return _format_profile_summary(inserted.data[0], user_id, email, full_name)
    except Exception as user_insert_exc:  # noqa: BLE001
        raw_msg = str(user_insert_exc).lower()
        if "23505" in raw_msg or "duplicate key" in raw_msg:
            try:
                refreshed = (
                    client.table("profiles").select(PROFILE_SELECT_COLS).eq("id", user_id).limit(1).execute()
                )
                if refreshed.data:
                    return _format_profile_summary(refreshed.data[0], user_id, email, full_name)
            except Exception as exc:  # noqa: BLE001
                classify_supabase_exception(exc, operation="profile lookup")

        # Only fall back to privileged bootstrap if user-level insert failed on RLS/trigger timing
        if "pgrst205" in raw_msg or "schema cache" in raw_msg or "does not exist" in raw_msg:
            classify_supabase_exception(user_insert_exc, operation="profile initialization")

        logger.warning(
            "User-scoped profile insert fell back to secret bootstrap for user_id=%s (%s)",
            user_id,
            type(user_insert_exc).__name__,
        )
        try:
            secret_client = get_secret_client()
            inserted = (
                secret_client.table("profiles")
                .upsert(new_profile_payload, on_conflict="id")
                .execute()
            )
            if inserted.data:
                logger.info("Initialized new profile via bootstrap fallback for user_id=%s", user_id)
                return _format_profile_summary(inserted.data[0], user_id, email, full_name)
        except Exception as secret_exc:  # noqa: BLE001
            classify_supabase_exception(secret_exc, operation="profile initialization")

    try:
        refreshed = client.table("profiles").select(PROFILE_SELECT_COLS).eq("id", user_id).limit(1).execute()
    except Exception as exc:  # noqa: BLE001
        classify_supabase_exception(exc, operation="profile verification")

    if not refreshed.data:
        raise ServiceUnavailableError(
            "Your account is verified, but your profile could not be initialized in Supabase right now. Please retry.",
            error_code="profile_initialization_failed",
        )
    return _format_profile_summary(refreshed.data[0], user_id, email, full_name)


@auth_bp.get("/me")
@require_auth(require_verified_email=True)
def get_authenticated_session():
    """Verify user access token, confirm email status, initialize profile if needed, and return session summary."""
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
    """Allow verified user to update onboarding step, completion, or skip state."""
    payload = request.get_json(silent=True) or {}
    updates: dict[str, object] = {}

    if "onboarding_status" in payload:
        status = str(payload.get("onboarding_status", "")).strip()
        if status not in ("not_started", "in_progress", "completed", "skipped"):
            raise ValidationError("Invalid onboarding status value.")
        updates["onboarding_status"] = status

    if "onboarding_step" in payload:
        try:
            step = int(payload.get("onboarding_step"))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Invalid onboarding step value.") from exc
        if step < 1 or step > 7:
            raise ValidationError("Onboarding step must be between 1 and 7.")
        updates["onboarding_step"] = step

    if "full_name" in payload and str(payload.get("full_name", "")).strip():
        updates["full_name"] = str(payload.get("full_name", "")).strip()[:120]

    if not updates:
        raise ValidationError("At least one onboarding field is required.")

    user = g.current_user
    _ensure_user_profile(user.user_id, user.email, user.full_name)

    client = get_user_client()
    try:
        updated = client.table("profiles").update(updates).eq("id", user.user_id).execute()
        if updated.data:
            row = updated.data[0]
        else:
            refreshed = (
                client.table("profiles").select(PROFILE_SELECT_COLS).eq("id", user.user_id).limit(1).execute()
            )
            row = (refreshed.data or [{}])[0]
    except Exception as exc:  # noqa: BLE001
        classify_supabase_exception(exc, operation="onboarding update")

    profile = _format_profile_summary(row, user.user_id, user.email, user.full_name)
    return success_response(data={"profile": profile}, message="Onboarding progress updated.")
