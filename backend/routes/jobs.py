"""Job description analysis and compatibility Blueprint (Phase 5 implementation target)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

jobs_bp = Blueprint("jobs", __name__, url_prefix="/api/jobs")


@jobs_bp.route("", methods=["GET", "POST"])
@jobs_bp.route("/<job_id>", methods=["GET", "PUT", "DELETE"])
@jobs_bp.route("/analyze", methods=["POST"])
@jobs_bp.route("/<job_id>/compatibility", methods=["POST"])
@require_auth(require_verified_email=True)
def jobs_placeholder(job_id: str | None = None):
    return error_response(
        "Job analysis and compatibility endpoints are scheduled for Phase 5.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
