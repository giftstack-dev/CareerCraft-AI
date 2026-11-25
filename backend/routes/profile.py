"""Career profile CRUD Blueprint (Phase 3 implementation target)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")


@profile_bp.route("", methods=["GET", "PUT"])
@require_auth(require_verified_email=True)
def profile_root():
    return error_response(
        "Profile management endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@profile_bp.route("/experience", methods=["POST"])
@profile_bp.route("/experience/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def profile_experience(record_id: str | None = None):
    return error_response(
        "Experience endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@profile_bp.route("/education", methods=["POST"])
@profile_bp.route("/education/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def profile_education(record_id: str | None = None):
    return error_response(
        "Education endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@profile_bp.route("/skills", methods=["POST"])
@profile_bp.route("/skills/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def profile_skills(record_id: str | None = None):
    return error_response(
        "Skills endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@profile_bp.route("/projects", methods=["POST"])
@profile_bp.route("/projects/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def profile_projects(record_id: str | None = None):
    return error_response(
        "Projects endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@profile_bp.route("/certifications", methods=["POST"])
@profile_bp.route("/certifications/<record_id>", methods=["PUT", "DELETE"])
@require_auth(require_verified_email=True)
def profile_certifications(record_id: str | None = None):
    return error_response(
        "Certifications endpoints are scheduled for Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
