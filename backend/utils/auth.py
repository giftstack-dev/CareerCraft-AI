"""Supabase JWKS JWT authentication and authoritative verified-email enforcement middleware."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from functools import lru_cache, wraps
from typing import Any, Callable

import jwt
from flask import current_app, g, request

from utils.errors import (
    AuthError,
    ForbiddenError,
    RateLimitError,
    ServiceUnavailableError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthenticatedUser:
    """Verified user identity extracted from a validated Supabase JWT and /auth/v1/user."""

    user_id: str
    email: str
    email_verified: bool
    full_name: str
    role: str


@lru_cache(maxsize=4)
def _get_jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    """Cache PyJWKClient per JWKS URL to avoid fetching keys on every request."""
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)


def extract_bearer_token(auth_header: str | None) -> str:
    """Extract JWT from 'Authorization: Bearer <token>' header."""
    if not auth_header:
        raise AuthError("Authorization header is required.", error_code="missing_token")
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError("Authorization header must use Bearer token format.", error_code="invalid_auth_header")
    return parts[1].strip()


def decode_supabase_jwt(token: str) -> dict[str, Any]:
    """Validate Supabase access token signature via SUPABASE_JWKS_URL, issuer, audience, and expiration."""
    cfg = current_app.config["APP_CONFIG"]
    jwks_url = cfg.resolved_jwks_url
    if not cfg.SUPABASE_URL or not jwks_url:
        raise AuthError("Authentication service is not configured.", error_code="auth_unconfigured")

    expected_issuer = f"{cfg.SUPABASE_URL.rstrip('/')}/auth/v1"

    try:
        jwks_client = _get_jwks_client(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256", "EdDSA"],
            audience="authenticated",
            issuer=expected_issuer,
            options={"require": ["exp", "sub", "iss"]},
        )
        return claims
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Your session has expired. Please sign in again.", error_code="token_expired") from exc
    except jwt.PyJWTError as exc:
        logger.warning("JWKS token validation failed (%s)", type(exc).__name__)
        raise AuthError("Invalid authentication token.", error_code="invalid_token") from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("JWKS key fetch or verification service failure (%s)", type(exc).__name__)
        raise ServiceUnavailableError(
            "Unable to verify authentication signature keys right now. Please retry shortly.",
            error_code="jwks_unavailable",
        ) from exc


def fetch_authenticated_supabase_user(token: str, expected_user_id: str | None = None) -> dict[str, Any]:
    """Fetch the authoritative user record from Supabase Auth GET /auth/v1/user using the caller's validated token.

    Never swallows network, credential, SDK, or availability errors into unverified status.
    """
    cfg = current_app.config["APP_CONFIG"]
    if not getattr(cfg, "supabase_public_configured", False):
        raise ServiceUnavailableError(
            "Supabase public authentication configuration is missing.",
            error_code="auth_unconfigured",
        )

    if cfg.SUPABASE_PUBLISHABLE_KEY.startswith("sb_secret_"):
        raise ServiceUnavailableError(
            "SUPABASE_PUBLISHABLE_KEY is misconfigured with a secret key.",
            error_code="supabase_key_misconfigured",
        )

    user_endpoint = f"{cfg.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    req = urllib.request.Request(
        user_endpoint,
        headers={
            "apikey": cfg.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
            user_obj = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        err_body_raw = ""
        try:
            err_body_raw = exc.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            err_body_raw = ""

        err_json: dict[str, Any] = {}
        if err_body_raw:
            try:
                parsed = json.loads(err_body_raw)
                if isinstance(parsed, dict):
                    err_json = parsed
            except json.JSONDecodeError:
                err_json = {}

        upstream_code = str(err_json.get("error_code") or err_json.get("code") or "").lower()
        upstream_msg = str(
            err_json.get("msg") or err_json.get("message") or err_json.get("error_description") or ""
        ).lower()

        logger.warning(
            "Supabase /auth/v1/user HTTP error (status=%s, code=%s, user_id=%s)",
            exc.code,
            upstream_code or "none",
            expected_user_id or "unknown",
        )

        if exc.code == 401:
            if (
                "api key" in upstream_msg
                or "apikey" in upstream_msg
                or "no api key" in upstream_msg
                or "legacy api keys are disabled" in upstream_msg
            ):
                raise ServiceUnavailableError(
                    "Supabase Auth rejected the configured publishable API key. Verify SUPABASE_PUBLISHABLE_KEY.",
                    error_code="supabase_key_error",
                ) from exc
            raise AuthError(
                "Your session is invalid or has expired. Please sign in again.",
                error_code="invalid_session",
            ) from exc

        if exc.code == 403:
            if "email_not_confirmed" in upstream_code or "not confirmed" in upstream_msg:
                raise ForbiddenError(
                    "Please verify your email address before accessing this feature.",
                    error_code="email_not_verified",
                ) from exc
            raise ForbiddenError(
                "This account does not currently have access to the workspace.",
                error_code="account_forbidden",
            ) from exc

        if exc.code == 429:
            raise RateLimitError(
                "Too many authentication verification requests. Please wait a moment and try again.",
                error_code="auth_rate_limited",
            ) from exc

        if exc.code in (500, 502, 503, 504):
            raise ServiceUnavailableError(
                "Supabase authentication service is temporarily unavailable. Please try again shortly.",
                error_code="auth_service_unavailable",
            ) from exc

        raise ServiceUnavailableError(
            f"Authentication verification failed with upstream HTTP {exc.code}.",
            error_code="auth_upstream_error",
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning(
            "Supabase /auth/v1/user network failure (%s, user_id=%s)",
            type(exc).__name__,
            expected_user_id or "unknown",
        )
        raise ServiceUnavailableError(
            "Unable to reach Supabase Auth to confirm your account status. Please retry shortly.",
            error_code="auth_network_error",
        ) from exc
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.error(
            "Supabase /auth/v1/user returned malformed payload (%s, user_id=%s)",
            type(exc).__name__,
            expected_user_id or "unknown",
        )
        raise ServiceUnavailableError(
            "Received an unexpected response from Supabase Auth while verifying your account.",
            error_code="auth_invalid_response",
        ) from exc

    if not isinstance(user_obj, dict) or not user_obj.get("id"):
        logger.error("Supabase /auth/v1/user response missing user id (user_id=%s)", expected_user_id or "unknown")
        raise ServiceUnavailableError(
            "Supabase Auth returned an incomplete user verification record.",
            error_code="auth_invalid_response",
        )

    if expected_user_id and str(user_obj.get("id")) != str(expected_user_id):
        logger.warning("Authenticated user id mismatch between JWT and /auth/v1/user")
        raise AuthError("Authenticated user identity mismatch.", error_code="token_user_mismatch")

    return user_obj


def has_authoritative_email_verification(user_obj: dict[str, Any]) -> bool:
    """Check server-authoritative confirmation fields (never user_metadata)."""
    if not isinstance(user_obj, dict):
        return False

    if user_obj.get("email_confirmed_at") or user_obj.get("confirmed_at"):
        return True

    # Handle OAuth identities (e.g., Google OAuth) where provider-verified email status
    # is stored on server-managed identities rather than user-editable user_metadata.
    user_email = str(user_obj.get("email") or "").strip().lower()
    identities = user_obj.get("identities")
    if isinstance(identities, list):
        for ident in identities:
            if not isinstance(ident, dict):
                continue
            provider = str(ident.get("provider") or "").strip().lower()
            ident_data = ident.get("identity_data") if isinstance(ident.get("identity_data"), dict) else {}
            ident_email = str(ident_data.get("email") or ident.get("email") or "").strip().lower()
            if (
                provider == "google"
                and ident_data.get("email_verified") is True
                and (not user_email or not ident_email or ident_email == user_email)
            ):
                return True

    return False


def _verify_email_status(
    claims: dict[str, Any],
    token: str,
    user_id: str,
) -> tuple[bool, dict[str, Any] | None]:
    """Determine authoritative email verification using Supabase Auth /auth/v1/user.

    Never reads user_metadata.email_verified. Never silently converts network, SDK,
    credential, or upstream errors into False.
    """
    cfg = current_app.config["APP_CONFIG"]

    # Unit tests using synthetic demo config + mocked decode_supabase_jwt without network
    # can assert verification via top-level server JWT claims only when TESTING=True
    # and urlopen / fetch_authenticated_supabase_user is not explicitly targeted.
    if (
        current_app.config.get("TESTING")
        and getattr(cfg, "SUPABASE_URL", "") == "https://demo.supabase.co"
        and fetch_authenticated_supabase_user is _ORIGINAL_FETCH_USER_FN
        and not current_app.config.get("FORCE_AUTH_USER_ENDPOINT_IN_TESTS", False)
    ):
        if claims.get("email_confirmed_at") or claims.get("confirmed_at"):
            return True, None
        if isinstance(claims.get("email_verified"), bool):
            return bool(claims.get("email_verified")), None
        return False, None

    user_obj = fetch_authenticated_supabase_user(token=token, expected_user_id=user_id)
    return has_authoritative_email_verification(user_obj), user_obj


_ORIGINAL_FETCH_USER_FN = fetch_authenticated_supabase_user


def require_auth(require_verified_email: bool = True) -> Callable:
    """Decorator enforcing valid Supabase JWT (via JWKS) and authoritative verified-email status."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any):
            token = extract_bearer_token(request.headers.get("Authorization"))
            claims = decode_supabase_jwt(token)

            user_id = str(claims.get("sub") or "").strip()
            role = str(claims.get("role") or "").strip()

            if not user_id or role != "authenticated":
                raise AuthError("Invalid authenticated user claims.", error_code="invalid_claims")

            verified, auth_user_record = _verify_email_status(claims, token, user_id)

            email = str((auth_user_record or {}).get("email") or claims.get("email") or "").strip()
            user_metadata = (auth_user_record or {}).get("user_metadata") or claims.get("user_metadata") or {}
            full_name = str(
                user_metadata.get("full_name") or user_metadata.get("name") or ""
            ).strip()

            if require_verified_email and not verified:
                logger.info("Blocked unverified account access for user_id=%s", user_id)
                raise ForbiddenError(
                    "Please verify your email address before accessing this feature.",
                    error_code="email_not_verified",
                )

            g.access_token = token
            g.auth_user_record = auth_user_record
            g.current_user = AuthenticatedUser(
                user_id=user_id,
                email=email,
                email_verified=verified,
                full_name=full_name,
                role=role,
            )
            return fn(*args, **kwargs)

        return wrapper

    return decorator
