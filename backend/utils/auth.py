"""Supabase JWT authentication and verified-email enforcement middleware."""

from __future__ import annotations

from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable

import jwt
from flask import current_app, g, request

from utils.errors import AuthError, ForbiddenError


@dataclass(frozen=True)
class AuthenticatedUser:
    """Verified user identity extracted from a validated Supabase JWT."""

    user_id: str
    email: str
    email_verified: bool
    role: str


def extract_bearer_token(auth_header: str | None) -> str:
    """Extract JWT from 'Authorization: Bearer <token>' header."""
    if not auth_header:
        raise AuthError("Authorization header is required.", error_code="missing_token")
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError("Authorization header must use Bearer token format.", error_code="invalid_auth_header")
    return parts[1].strip()


def decode_supabase_jwt(token: str) -> dict[str, Any]:
    """Validate Supabase access token signature, issuer, and expiration."""
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.SUPABASE_URL:
        raise AuthError("Authentication service is not configured.", error_code="auth_unconfigured")

    expected_issuer = f"{cfg.SUPABASE_URL.rstrip('/')}/auth/v1"

    try:
        if cfg.SUPABASE_JWT_SECRET:
            claims = jwt.decode(
                token,
                cfg.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=expected_issuer,
                options={"require": ["exp", "sub", "iss"]},
            )
            return claims

        jwks_url = f"{expected_issuer}/.well-known/jwks.json"
        jwks_client = jwt.PyJWKClient(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=expected_issuer,
            options={"require": ["exp", "sub", "iss"]},
        )
        return claims
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Your session has expired. Please sign in again.", error_code="token_expired") from exc
    except jwt.PyJWTError as exc:
        raise AuthError("Invalid authentication token.", error_code="invalid_token") from exc


def _is_email_verified(claims: dict[str, Any]) -> bool:
    """Determine verified email status from Supabase JWT claims."""
    user_metadata = claims.get("user_metadata") or {}
    app_metadata = claims.get("app_metadata") or {}
    if claims.get("email_confirmed_at"):
        return True
    if user_metadata.get("email_verified") is True:
        return True
    if app_metadata.get("provider") == "email" and claims.get("email_verified") is True:
        return True
    return bool(claims.get("email_verified") is True)


def require_auth(require_verified_email: bool = True) -> Callable:
    """Decorator enforcing valid Supabase JWT and verified email on protected routes."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any):
            token = extract_bearer_token(request.headers.get("Authorization"))
            claims = decode_supabase_jwt(token)

            user_id = claims.get("sub", "")
            email = claims.get("email", "")
            role = claims.get("role", "")
            verified = _is_email_verified(claims)

            if not user_id or role != "authenticated":
                raise AuthError("Invalid authenticated user claims.", error_code="invalid_claims")

            if require_verified_email and not verified:
                raise ForbiddenError(
                    "Please verify your email address before accessing this feature.",
                    error_code="email_not_verified",
                )

            g.current_user = AuthenticatedUser(
                user_id=user_id,
                email=email,
                email_verified=verified,
                role=role,
            )
            return fn(*args, **kwargs)

        return wrapper

    return decorator
