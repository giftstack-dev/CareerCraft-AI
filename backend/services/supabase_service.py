"""Centralised Supabase client factory (backend-only service role and scoped clients)."""

from __future__ import annotations

from flask import current_app
from supabase import Client, create_client

from utils.errors import ServiceUnavailableError


def get_service_client() -> Client:
    """Return a privileged Supabase client using SUPABASE_SERVICE_ROLE_KEY.

    Only for server-side operations after JWT verification and ownership checks.
    """
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.supabase_configured:
        raise ServiceUnavailableError("Database service is not configured yet.")
    return create_client(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY)


def get_anon_client() -> Client:
    """Return a Supabase client initialised with the public anon key."""
    cfg = current_app.config["APP_CONFIG"]
    if not cfg.SUPABASE_URL or not cfg.SUPABASE_ANON_KEY:
        raise ServiceUnavailableError("Supabase public configuration is missing.")
    return create_client(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
