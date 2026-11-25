"""Server-side AI usage safeguard and quota tracking service."""

from __future__ import annotations

from datetime import datetime, timezone
from flask import current_app

from services.supabase_service import get_service_client
from utils.errors import RateLimitError


def enforce_daily_ai_quota(user_id: str) -> int:
    """Check authenticated user's daily AI operations against configured limit.

    Returns remaining requests for the current UTC day.
    """
    cfg = current_app.config["APP_CONFIG"]
    limit = cfg.AI_DAILY_REQUEST_LIMIT
    client = get_service_client()

    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    result = (
        client.table("usage_records")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .in_("request_status", ["pending", "success"])
        .gte("created_at", day_start)
        .execute()
    )
    used = result.count or 0
    if used >= limit:
        raise RateLimitError(
            f"Daily AI preparation limit ({limit} requests) reached. "
            "Your existing profile and saved documents remain accessible, and limits reset at 00:00 UTC."
        )
    return max(limit - used, 0)


def record_usage(
    *,
    user_id: str,
    operation_type: str,
    ai_model: str,
    request_status: str,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> None:
    """Persist server-controlled AI usage record."""
    client = get_service_client()
    client.table("usage_records").insert(
        {
            "user_id": user_id,
            "operation_type": operation_type,
            "ai_model": ai_model,
            "request_status": request_status,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }
    ).execute()
