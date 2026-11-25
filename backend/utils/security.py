"""Security utilities: HTTP headers, safe filenames, and path containment checks."""

from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from flask import Response

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def apply_security_headers(response: Response, is_production: bool = True) -> Response:
    """Attach standard security headers to every Flask HTTP response."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "0"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    if is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def sanitize_filename(filename: str, fallback: str = "document") -> str:
    """Sanitize an uploaded filename to prevent path traversal and unsafe characters."""
    base = os.path.basename(filename or "").strip()
    cleaned = SAFE_FILENAME_RE.sub("_", base).strip("._")
    if not cleaned:
        return fallback
    return cleaned[:120]


def validate_user_storage_path(storage_path: str, user_id: str) -> bool:
    """Verify a Supabase storage path strictly belongs to the authenticated user."""
    if not storage_path or not user_id:
        return False
    if ".." in storage_path or storage_path.startswith("/"):
        return False
    parts = storage_path.split("/")
    return len(parts) >= 3 and parts[0] == str(user_id)
