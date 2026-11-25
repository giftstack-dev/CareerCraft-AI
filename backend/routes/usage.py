"""Usage and quota visibility Blueprint."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

usage_bp = Blueprint("usage", __name__, url_prefix="/api/usage")


@usage_bp.route("", methods=["GET"])
@require_auth(require_verified_email=True)
def usage_placeholder():
    return error_response(
        "Usage summary endpoint will be enabled in Phase 4.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
