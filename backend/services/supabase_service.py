"""Centralised Supabase client factory (backend-only secret key and public publishable clients)."""

from __future__ import annotations

from flask import current_app
from supabase import Client, create_client

from utils.errors import ServiceUnavailableError


def get_secret_client() -> Client:
    """Return a privileged Supabase client using SUPABASE_SECRET_KEY.

    Only for server-side operations after JWT verification and ownership checks.
    """
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_configured:
        raise ServiceUnavailableError("Database service is not configured yet.")
    return create_client(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY)


def get_public_client() -> Client:
    """Return a Supabase client initialised with the public publishable key."""
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_public_configured:
        raise ServiceUnavailableError("Supabase public configuration is missing.")
    return create_client(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)


# Backward-compatible internal alias for existing usage_service calls
def get_service_client() -> Client:
    return get_secret_client()
