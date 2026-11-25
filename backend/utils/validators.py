"""Input validation helpers for REST API payloads and identifiers."""

from __future__ import annotations

import re
import uuid
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_uuid(value: str) -> bool:
    """Return True if value is a valid UUID string."""
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False


def is_valid_email(value: str) -> bool:
    """Basic structural email validation."""
    if not isinstance(value, str):
        return False
    return bool(EMAIL_RE.match(value.strip()))


def is_safe_http_url(value: str) -> bool:
    """Validate URL uses http or https scheme only (blocks javascript: and data:)."""
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)
