"""Centralised Supabase client factory (backend-only secret key and public publishable clients)."""

from __future__ import annotations

from flask import current_app, g
from supabase import Client, create_client

try:
    from supabase.client import ClientOptions
except ImportError:  # pragma: no cover - fallback for older minor bindings
    ClientOptions = None

from utils.errors import AuthError, ServiceUnavailableError


def get_user_client(access_token: str | None = None) -> Client:
    """Return a user-scoped Supabase client enforcing PostgreSQL & Storage RLS via user JWT."""
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_public_configured:
        raise ServiceUnavailableError("Database public authentication configuration is missing.")

    token = (access_token or getattr(g, "access_token", "") or "").strip()
    if not token:
        raise AuthError("Authenticated user token is required.", error_code="missing_token")

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
    return client


def get_secret_client() -> Client:
    """Return a privileged Supabase client using SUPABASE_SECRET_KEY.

    Strictly reserved for administrative operations that require elevated privileges
    (auth admin operations, server-controlled usage_records writes, notification inserts,
    and post-delete account storage cleanup).
    """
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_configured:
        raise ServiceUnavailableError("Database service is not configured yet.")
    return create_client(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY)


# Backward-compatible internal alias for usage_service calls
def get_service_client() -> Client:
    return get_secret_client()
