"""Application tracker Blueprint (Phase 8 implementation target)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

applications_bp = Blueprint("applications", __name__, url_prefix="/api/applications")


@applications_bp.route("", methods=["GET", "POST"])
@applications_bp.route("/<application_id>", methods=["GET", "PUT", "DELETE"])
@require_auth(require_verified_email=True)
def applications_placeholder(application_id: str | None = None):
    return error_response(
        "Application tracker endpoints are scheduled for Phase 8.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
