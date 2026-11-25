"""Daily AI Usage & Safeguard Quota Visibility Blueprint."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, g

from services.profile_service import handle_supabase_error
from services.supabase_service import get_user_client
from utils.auth import require_auth
from utils.errors import success_response

usage_bp = Blueprint("usage", __name__, url_prefix="/api/usage")


@usage_bp.get("")
@require_auth(require_verified_email=True)
def get_usage_summary():
    user_id = g.current_user.user_id
    cfg = current_app.config["APP_CONFIG"]
    limit = cfg.AI_DAILY_REQUEST_LIMIT
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    client = get_user_client()

    try:
        today_res = (
            client.table("usage_records")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .in_("request_status", ["pending", "success"])
            .gte("created_at", day_start)
            .execute()
        )
        recent_res = (
            client.table("usage_records")
            .select("id, operation_type, ai_model, request_status, total_tokens, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    used_today = today_res.count or 0
    return success_response(
        data={
            "daily_limit": limit,
            "used_today": used_today,
            "remaining_today": max(limit - used_today, 0),
            "reset_schedule": "Daily at 00:00 UTC",
            "recent_records": recent_res.data or [],
        },
        message="Daily AI usage summary loaded.",
    )
