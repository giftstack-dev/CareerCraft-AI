"""CV upload and extraction Blueprint (Phase 4 implementation target)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

cv_bp = Blueprint("cv", __name__, url_prefix="/api/cv")


@cv_bp.route("/upload", methods=["POST"])
@cv_bp.route("/parse", methods=["POST"])
@cv_bp.route("/confirm", methods=["POST"])
@cv_bp.route("", methods=["GET"])
@cv_bp.route("/<cv_id>", methods=["GET", "DELETE"])
@require_auth(require_verified_email=True)
def cv_placeholder(cv_id: str | None = None):
    return error_response(
        "CV upload and extraction endpoints are scheduled for Phase 4.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
