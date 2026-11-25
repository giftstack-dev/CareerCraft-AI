"""Interview preparation Blueprint (Phase 9 implementation target)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

interviews_bp = Blueprint("interviews", __name__, url_prefix="/api/interviews")


@interviews_bp.route("/generate", methods=["POST"])
@interviews_bp.route("", methods=["GET"])
@interviews_bp.route("/<session_id>", methods=["GET", "PUT", "DELETE"])
@require_auth(require_verified_email=True)
def interviews_placeholder(session_id: str | None = None):
    return error_response(
        "Interview preparation endpoints are scheduled for Phase 9.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
