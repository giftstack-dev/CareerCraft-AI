"""System health and dashboard summary endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from flask import Blueprint, current_app

from utils.auth import require_auth
from utils.errors import error_response, success_response

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/api/health")
def health_check():
    """Public health check reporting runtime readiness without exposing secrets."""
    cfg = current_app.config["APP_CONFIG"]
    return success_response(
        data={
            "status": "ok",
            "service": "careercraft-ai-backend",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": {
                "supabase_configured": cfg.supabase_configured,
                "gemini_configured": cfg.gemini_configured,
                "max_upload_size_mb": cfg.MAX_UPLOAD_SIZE_MB,
            },
        },
        message="CareerCraft AI backend is running.",
    )


@dashboard_bp.get("/api/dashboard")
@require_auth(require_verified_email=True)
def get_dashboard():
    """Dashboard aggregation endpoint (implemented in Phase 3)."""
    return error_response(
        "Dashboard aggregation will be enabled in Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
