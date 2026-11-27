"""Centralised Supabase client factory, SDK/key compatibility verification, and error classification."""

from __future__ import annotations

import logging
import re
from typing import Any, NoReturn

import supabase as supabase_pkg
from flask import current_app, g
from supabase import Client, create_client

try:
    from supabase.client import ClientOptions
except ImportError:  # pragma: no cover - fallback for older minor bindings
    ClientOptions = None

from utils.errors import (
    AppError,
    AuthError,
    ForbiddenError,
    RateLimitError,
    ServiceUnavailableError,
)

logger = logging.getLogger(__name__)
_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?")


def _parse_semver(version_str: str) -> tuple[int, int, int]:
    match = _SEMVER_RE.match(str(version_str or "").strip())
    if not match:
        return (0, 0, 0)
    return (int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))


def check_supabase_sdk_compatibility(cfg: Any) -> dict[str, Any]:
    """Verify compatibility between installed supabase-py SDK and configured modern/legacy API keys."""
    sdk_version = str(getattr(supabase_pkg, "__version__", "unknown") or "unknown")
    parsed_ver = _parse_semver(sdk_version)

    pub_key = str(getattr(cfg, "SUPABASE_PUBLISHABLE_KEY", "") or "")
    sec_key = str(getattr(cfg, "SUPABASE_SECRET_KEY", "") or "")

    uses_modern_publishable = pub_key.startswith("sb_publishable_")
    uses_modern_secret = sec_key.startswith("sb_secret_")
    misconfigured_key_role = pub_key.startswith("sb_secret_") or sec_key.startswith("sb_publishable_")

    # Native opaque sb_publishable_ / sb_secret_ handling matured across supabase-py >= 2.16.0
    sdk_supports_modern_keys = parsed_ver >= (2, 16, 0)
    compatible = (not misconfigured_key_role) and (
        (not uses_modern_publishable and not uses_modern_secret) or sdk_supports_modern_keys
    )

    issue = None
    if misconfigured_key_role:
        issue = "SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY appear swapped or assigned the wrong key prefix."
    elif (uses_modern_publishable or uses_modern_secret) and not sdk_supports_modern_keys:
        issue = (
            f"Installed supabase SDK ({sdk_version}) predates full sb_publishable_/sb_secret_ support; "
            "upgrade to supabase>=2.18.0."
        )

    return {
        "sdk_version": sdk_version,
        "uses_modern_publishable": uses_modern_publishable,
        "uses_modern_secret": uses_modern_secret,
        "misconfigured_key_role": misconfigured_key_role,
        "sdk_compatible": compatible,
        "issue": issue,
    }


def classify_supabase_exception(
    exc: Exception,
    operation: str = "database operation",
) -> NoReturn:
    """Translate Supabase/PostgREST/network exceptions into accurate HTTP status errors."""
    if isinstance(exc, AppError):
        raise exc

    raw = str(exc)
    lower = raw.lower()
    exc_type = type(exc).__name__

    if "pgrst205" in lower or "schema cache" in lower or "does not exist" in lower:
        logger.error("Supabase schema error during %s (%s)", operation, exc_type)
        raise ServiceUnavailableError(
            "Database schema is not initialized yet. Execute the Supabase SQL schema and migrations first.",
            error_code="schema_not_initialized",
        ) from exc

    if (
        "invalid api key" in lower
        or "no api key found" in lower
        or "apikey" in lower
        or "legacy api keys are disabled" in lower
    ):
        logger.error("Supabase API key or SDK compatibility error during %s (%s)", operation, exc_type)
        raise ServiceUnavailableError(
            "Supabase rejected the configured API key format or SDK headers. Verify SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, and supabase SDK version.",
            error_code="supabase_key_error",
        ) from exc

    if "jwt expired" in lower or "pgrst301" in lower or "invalid jwt" in lower:
        logger.warning("Supabase rejected user JWT during %s (%s)", operation, exc_type)
        raise AuthError(
            "Your session token was rejected or expired. Please sign in again.",
            error_code="invalid_session",
        ) from exc

    if "42501" in lower or "row-level security" in lower or "permission denied" in lower:
        logger.error("Supabase RLS/permission error during %s (%s)", operation, exc_type)
        raise ServiceUnavailableError(
            f"Database access policy prevented {operation}. Verify Supabase RLS policies and grants SQL migrations.",
            error_code="database_permission_error",
        ) from exc

    if "429" in lower or "rate limit" in lower or "too many requests" in lower:
        logger.warning("Supabase rate limit hit during %s (%s)", operation, exc_type)
        raise RateLimitError(
            f"Supabase rate limit reached during {operation}. Please retry shortly.",
            error_code="upstream_rate_limited",
        ) from exc

    if any(
        term in lower
        for term in (
            "timeout",
            "timed out",
            "connecterror",
            "connection refused",
            "name or service not known",
            "temporary failure in name resolution",
            "remoteprotocolerror",
            "network",
            "502",
            "503",
            "504",
        )
    ):
        logger.warning("Supabase network/availability error during %s (%s)", operation, exc_type)
        raise ServiceUnavailableError(
            f"Supabase service is temporarily unreachable during {operation}. Please retry shortly.",
            error_code="database_unavailable",
        ) from exc

    logger.error("Unexpected Supabase error during %s (%s)", operation, exc_type)
    raise ServiceUnavailableError(
        f"Unable to complete {operation} against Supabase right now. Please try again shortly.",
        error_code="database_error",
    ) from exc


def get_user_client(access_token: str | None = None) -> Client:
    """Return a user-scoped Supabase client enforcing PostgreSQL & Storage RLS via user JWT."""
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_public_configured:
        raise ServiceUnavailableError(
            "Database public authentication configuration is missing.",
            error_code="supabase_unconfigured",
        )
    if cfg.SUPABASE_PUBLISHABLE_KEY.startswith("sb_secret_"):
        raise ServiceUnavailableError(
            "SUPABASE_PUBLISHABLE_KEY is misconfigured with a secret key.",
            error_code="supabase_key_misconfigured",
        )

    token = (access_token or getattr(g, "access_token", "") or "").strip()
    if not token:
        raise AuthError("Authenticated user token is required.", error_code="missing_token")
    if token.startswith("sb_secret_") or token.startswith("sb_publishable_"):
        raise AuthError("A valid user access token is required.", error_code="invalid_token")

    compat = check_supabase_sdk_compatibility(cfg)
    if not compat["sdk_compatible"] and compat["issue"]:
        logger.warning("Supabase SDK compatibility check warning: %s", compat["issue"])

    if ClientOptions is not None:
        options = ClientOptions(
            headers={"Authorization": f"Bearer {token}"},
            auto_refresh_token=False,
            persist_session=False,
        )
        client = create_client(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, options=options)
    else:
        client = create_client(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)

    if hasattr(client, "postgrest") and hasattr(client.postgrest, "auth"):
        client.postgrest.auth(token)
        session = getattr(client.postgrest, "session", None)
        if session is not None and hasattr(session, "headers"):
            session.headers["apikey"] = cfg.SUPABASE_PUBLISHABLE_KEY
            session.headers["Authorization"] = f"Bearer {token}"

    storage_client = getattr(client, "storage", None)
    storage_session = getattr(storage_client, "session", None)
    if storage_session is not None and hasattr(storage_session, "headers"):
        storage_session.headers["apikey"] = cfg.SUPABASE_PUBLISHABLE_KEY
        storage_session.headers["Authorization"] = f"Bearer {token}"

    return client


def get_secret_client() -> Client:
    """Return a privileged Supabase client using SUPABASE_SECRET_KEY.

    Strictly reserved for administrative operations that require elevated privileges
    (auth admin operations, bootstrap fallback if profile RLS insert fails,
    server-controlled usage_records writes, notification inserts, and account deletion).
    """
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_configured:
        raise ServiceUnavailableError(
            "Database service is not configured yet.",
            error_code="supabase_unconfigured",
        )
    if cfg.SUPABASE_SECRET_KEY.startswith("sb_publishable_"):
        raise ServiceUnavailableError(
            "SUPABASE_SECRET_KEY is misconfigured with a publishable key.",
            error_code="supabase_key_misconfigured",
        )

    compat = check_supabase_sdk_compatibility(cfg)
    if not compat["sdk_compatible"] and compat["issue"]:
        logger.warning("Supabase secret client compatibility warning: %s", compat["issue"])

    client = create_client(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY)

    # Defensive header alignment if an older SDK (<2.16) receives an opaque sb_secret_ key:
    if cfg.SUPABASE_SECRET_KEY.startswith("sb_secret_") and _parse_semver(compat["sdk_version"]) < (2, 16, 0):
        postgrest_session = getattr(getattr(client, "postgrest", None), "session", None)
        if postgrest_session is not None and hasattr(postgrest_session, "headers"):
            postgrest_session.headers["apikey"] = cfg.SUPABASE_SECRET_KEY
            if postgrest_session.headers.get("Authorization") == f"Bearer {cfg.SUPABASE_SECRET_KEY}":
                postgrest_session.headers.pop("Authorization", None)

    return client


# Backward-compatible internal alias for usage_service calls
def get_service_client() -> Client:
    return get_secret_client()
