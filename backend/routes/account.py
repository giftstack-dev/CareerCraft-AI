"""Account management and notifications Blueprint (Phase 2 & 10)."""

from __future__ import annotations

from flask import Blueprint

from utils.auth import require_auth
from utils.errors import error_response

account_bp = Blueprint("account", __name__)


@account_bp.route("/api/notifications", methods=["GET"])
@require_auth(require_verified_email=True)
def notifications_placeholder():
    return error_response(
        "Notifications endpoint will be enabled with Phase 2-3 authentication.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )


@account_bp.route("/api/account/delete", methods=["POST"])
@require_auth(require_verified_email=True)
def delete_account_placeholder():
    return error_response(
        "Account deletion endpoint will be enabled in Phase 2.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
