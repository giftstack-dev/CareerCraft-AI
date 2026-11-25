"""Centralised configuration for the CareerCraft AI Flask backend."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from typing import List


def _parse_origins(raw: str) -> List[str]:
    if not raw:
        return []
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    # Never allow wildcard CORS in authenticated API configurations
    return [origin for origin in origins if origin != "*"]


def _parse_int(value: str | None, default: int, minimum: int = 1) -> int:
    if not value:
        return default
    try:
        parsed = int(value)
        return max(parsed, minimum)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    """Application configuration loaded from environment variables."""

    FLASK_ENV: str = field(default_factory=lambda: os.getenv("FLASK_ENV", "production"))
    SECRET_KEY: str = field(
        default_factory=lambda: os.getenv("FLASK_SECRET_KEY") or secrets.token_hex(32)
    )
    SUPABASE_URL: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", "").strip())
    SUPABASE_PUBLISHABLE_KEY: str = field(
        default_factory=lambda: os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    )
    SUPABASE_SECRET_KEY: str = field(
        default_factory=lambda: os.getenv("SUPABASE_SECRET_KEY", "").strip()
    )
    SUPABASE_JWKS_URL: str = field(
        default_factory=lambda: os.getenv("SUPABASE_JWKS_URL", "").strip()
    )
    GEMINI_API_KEY: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip())
    GEMINI_MODEL: str = field(
        default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
        or "gemini-2.5-flash"
    )
    FRONTEND_URL: str = field(
        default_factory=lambda: os.getenv("FRONTEND_URL", "http://localhost:3000").strip()
    )
    ALLOWED_ORIGINS: List[str] = field(
        default_factory=lambda: _parse_origins(
            os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
        )
    )
    MAX_UPLOAD_SIZE_MB: int = field(
        default_factory=lambda: _parse_int(os.getenv("MAX_UPLOAD_SIZE_MB"), default=10, minimum=1)
    )
    AI_DAILY_REQUEST_LIMIT: int = field(
        default_factory=lambda: _parse_int(
            os.getenv("AI_DAILY_REQUEST_LIMIT"), default=30, minimum=1
        )
    )
    AI_REQUEST_TIMEOUT: int = field(
        default_factory=lambda: _parse_int(os.getenv("AI_REQUEST_TIMEOUT"), default=45, minimum=5)
    )
    TESTING: bool = False

    @property
    def max_content_length_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.FLASK_ENV.lower() == "production"

    @property
    def resolved_jwks_url(self) -> str:
        if self.SUPABASE_JWKS_URL and not self.SUPABASE_JWKS_URL.startswith("your_"):
            return self.SUPABASE_JWKS_URL
        if self.SUPABASE_URL and not self.SUPABASE_URL.startswith("your_"):
            return f"{self.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return ""

    @property
    def supabase_public_configured(self) -> bool:
        return bool(
            self.SUPABASE_URL
            and not self.SUPABASE_URL.startswith("your_")
            and self.SUPABASE_PUBLISHABLE_KEY
            and not self.SUPABASE_PUBLISHABLE_KEY.startswith("your_")
        )

    @property
    def supabase_configured(self) -> bool:
        return bool(
            self.supabase_public_configured
            and self.SUPABASE_SECRET_KEY
            and self.SUPABASE_SECRET_KEY != "backend_only_secret"
            and self.resolved_jwks_url
        )

    @property
    def gemini_configured(self) -> bool:
        return bool(
            self.GEMINI_API_KEY
            and self.GEMINI_API_KEY != "backend_only_secret"
            and self.GEMINI_MODEL
            and not self.GEMINI_MODEL.startswith("your_")
        )
