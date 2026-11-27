"""Pure-Python Gemini diagnostic classification, sanitization, backoff, and JSON helpers.

Kept free of third-party SDK imports so unit tests can verify classification,
secret redaction, retryability, and JSON validation in any Python 3.11+ runtime.
"""

from __future__ import annotations

import json
import random
import re
from typing import Any, Callable

_API_KEY_PARAM_RE = re.compile(r"([?&](?:key|api_key)=)[^&\s'\"]+", re.IGNORECASE)
_GOOGLE_API_KEY_RE = re.compile(r"AIza[0-9A-Za-z_\-]{10,}")
_HEADER_KEY_RE = re.compile(
    r"(x-goog-api-key['\"]?\s*[:=]\s*['\"]?)[^'\"\s,}\]]+",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.IGNORECASE)
_HTTP_STATUS_TEXT_RE = re.compile(
    r"\b([45]\d{2})\s+(?:BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|TOO_MANY_REQUESTS|"
    r"INTERNAL|UNAVAILABLE|GATEWAY_TIMEOUT|Bad Request|Unauthorized|Forbidden|"
    r"Not Found|Too Many Requests|Service Unavailable)\b"
)
_LEADING_HTTP_STATUS_RE = re.compile(r"^([45]\d{2})\b")
_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)

_GOOGLE_CANONICAL_STATUSES = (
    "API_KEY_INVALID",
    "PERMISSION_DENIED",
    "UNAUTHENTICATED",
    "NOT_FOUND",
    "INVALID_ARGUMENT",
    "FAILED_PRECONDITION",
    "RESOURCE_EXHAUSTED",
    "QUOTA_EXCEEDED",
    "RATE_LIMIT_EXCEEDED",
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "INTERNAL",
)

_NETWORK_EXCEPTION_NAMES = (
    "timeout",
    "connecterror",
    "readtimeout",
    "writetimeout",
    "pooltimeout",
    "networkerror",
    "remoteprotocolerror",
    "transporterror",
    "urlerror",
    "gaierror",
    "sslerror",
    "connectionerror",
)


class MalformedAIResponseError(ValueError):
    """Raised when Gemini returns an empty, blocked, truncated, or invalid JSON payload."""

    def __init__(self, message: str, *, reason_code: str = "invalid_json", finish_reason: str = "") -> None:
        super().__init__(message)
        self.reason_code = reason_code
        self.finish_reason = finish_reason


def sanitize_diagnostic_message(raw_message: Any, api_key: str = "", max_length: int = 280) -> str:
    """Scrub API keys, bearer tokens, and control whitespace from upstream error strings."""
    text = str(raw_message or "")
    if api_key and len(api_key) >= 4:
        text = text.replace(api_key, "[REDACTED]")
    text = _GOOGLE_API_KEY_RE.sub("[REDACTED_KEY]", text)
    text = _API_KEY_PARAM_RE.sub(r"\1[REDACTED]", text)
    text = _HEADER_KEY_RE.sub(r"\1[REDACTED]", text)
    text = _BEARER_RE.sub(r"\1[REDACTED]", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_length:
        return text[: max_length - 3].rstrip() + "..."
    return text


def extract_http_status(exc: Exception) -> int | None:
    """Extract an HTTP status code from google-genai APIError, httpx, or urllib exceptions."""
    candidates: list[Any] = [
        getattr(exc, "code", None),
        getattr(exc, "status_code", None),
        getattr(exc, "http_status", None),
    ]
    resp = getattr(exc, "response", None)
    if resp is not None:
        candidates.append(getattr(resp, "status_code", None))
        candidates.append(getattr(resp, "status", None))

    for val in candidates:
        if isinstance(val, bool):
            continue
        if isinstance(val, int) and 100 <= val <= 599:
            return val
        if isinstance(val, str) and val.isdigit():
            parsed = int(val)
            if 100 <= parsed <= 599:
                return parsed

    raw = str(exc or "")
    match = _HTTP_STATUS_TEXT_RE.search(raw) or _LEADING_HTTP_STATUS_RE.match(raw.strip())
    if match:
        parsed = int(match.group(1))
        if 100 <= parsed <= 599:
            return parsed
    return None


def extract_google_error_status(exc: Exception) -> str:
    """Extract canonical Google RPC / Gemini error status or reason token if available."""
    raw_status = getattr(exc, "status", None)
    if isinstance(raw_status, str) and raw_status.strip():
        normalized = raw_status.strip().upper()
        if normalized in _GOOGLE_CANONICAL_STATUSES or normalized.replace("_", "").isalpha():
            return normalized

    details = getattr(exc, "details", None)
    if isinstance(details, dict):
        for key in ("reason", "status", "error"):
            val = details.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip().upper()
        err_dict = details.get("error")
        if isinstance(err_dict, dict):
            st = err_dict.get("status")
            if isinstance(st, str) and st.strip():
                return st.strip().upper()

    combined = f"{getattr(exc, 'message', '')} {exc}".upper()
    for token in _GOOGLE_CANONICAL_STATUSES:
        if token in combined:
            return token
    return ""


def classify_gemini_exception(exc: Exception, *, api_key: str = "") -> dict[str, Any]:
    """Classify any Gemini SDK / transport / response error into category, retryability, and safe messaging."""
    error_type = type(exc).__name__
    http_status = extract_http_status(exc)
    google_status = extract_google_error_status(exc)
    raw_msg = getattr(exc, "message", None) or str(exc) or error_type
    diagnostic_message = sanitize_diagnostic_message(raw_msg, api_key=api_key)
    lower_msg = diagnostic_message.lower()
    lower_type = error_type.lower()

    # 1. Malformed / blocked / empty AI output
    if isinstance(exc, (MalformedAIResponseError, json.JSONDecodeError)):
        return {
            "error_type": error_type,
            "http_status": http_status,
            "google_status": google_status,
            "error_category": "malformed_response",
            "connectivity_status": "malformed_response",
            "retryable": False,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_malformed_response",
            "user_message": "The AI service returned an incomplete or unreadable response. Please try again shortly.",
            "diagnostic_message": diagnostic_message,
        }

    # 2. Invalid / unauthorized API key (note Gemini often returns HTTP 400 with API_KEY_INVALID)
    if (
        http_status in (401, 403)
        or google_status in ("API_KEY_INVALID", "PERMISSION_DENIED", "UNAUTHENTICATED")
        or any(
            token in lower_msg
            for token in (
                "api key not valid",
                "api_key_invalid",
                "invalid api key",
                "api key expired",
                "permission denied",
                "permission_denied",
                "unauthenticated",
                "consumer 'api_key",
            )
        )
    ):
        return {
            "error_type": error_type,
            "http_status": http_status,
            "google_status": google_status or "PERMISSION_DENIED",
            "error_category": "invalid_api_key",
            "connectivity_status": "auth_error",
            "retryable": False,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_auth_error",
            "user_message": "AI service authentication failed. Verify the configured backend Gemini API key.",
            "diagnostic_message": diagnostic_message,
        }

    # 3. Unsupported or unavailable model
    if (
        http_status == 404
        or google_status == "NOT_FOUND"
        or (
            "model" in lower_msg
            and any(
                token in lower_msg
                for token in (
                    "not found",
                    "not supported",
                    "deprecated",
                    "does not exist",
                    "no longer available",
                    "unknown model",
                )
            )
        )
    ):
        return {
            "error_type": error_type,
            "http_status": http_status,
            "google_status": google_status or "NOT_FOUND",
            "error_category": "unsupported_model",
            "connectivity_status": "model_unavailable",
            "retryable": False,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_model_unavailable",
            "user_message": "The configured Gemini model is unavailable or unsupported for this operation.",
            "diagnostic_message": diagnostic_message,
        }

    # 4. Quota exhaustion vs transient rate limiting
    if (
        http_status == 429
        or google_status in ("RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED", "RATE_LIMIT_EXCEEDED")
        or any(
            token in lower_msg
            for token in ("resource_exhausted", "quota", "rate limit", "too many requests")
        )
    ):
        is_hard_quota = google_status == "QUOTA_EXCEEDED" or any(
            token in lower_msg
            for token in (
                "exceeded your current quota",
                "quota_exceeded",
                "plan and billing",
                "billing",
                "free_tier",
                "limit: 0",
                "daily limit",
                "quota exhausted",
            )
        )
        if is_hard_quota:
            return {
                "error_type": error_type,
                "http_status": http_status or 429,
                "google_status": google_status or "RESOURCE_EXHAUSTED",
                "error_category": "quota_exhausted",
                "connectivity_status": "quota_exhausted",
                "retryable": False,
                "app_error_kind": "rate_limit",
                "app_error_code": "ai_quota_exhausted",
                "user_message": "Configured Gemini API quota has been exhausted. Check API quota or billing limits and retry later.",
                "diagnostic_message": diagnostic_message,
            }
        return {
            "error_type": error_type,
            "http_status": http_status or 429,
            "google_status": google_status or "RESOURCE_EXHAUSTED",
            "error_category": "rate_limited",
            "connectivity_status": "rate_limited",
            "retryable": True,
            "app_error_kind": "rate_limit",
            "app_error_code": "ai_rate_limited",
            "user_message": "The AI service is temporarily rate limited. Please try again in a few moments.",
            "diagnostic_message": diagnostic_message,
        }

    # 5. Incompatible request parameters / invalid schema
    if (
        http_status == 400
        or google_status in ("INVALID_ARGUMENT", "FAILED_PRECONDITION")
        or any(
            token in lower_msg
            for token in (
                "invalid_argument",
                "unknown name",
                "not supported for this model",
                "thinkingbudget",
                "thinking_budget",
                "thinking_level",
                "response_schema",
                "responseschema",
                "max_output_tokens",
                "invalid json payload",
            )
        )
    ):
        return {
            "error_type": error_type,
            "http_status": http_status or 400,
            "google_status": google_status or "INVALID_ARGUMENT",
            "error_category": "invalid_parameters",
            "connectivity_status": "invalid_request",
            "retryable": False,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_invalid_parameters",
            "user_message": "The AI request parameters or structured output schema were rejected by the model.",
            "diagnostic_message": diagnostic_message,
        }

    # 6. Network / transport / timeout failures
    if (
        isinstance(exc, (TimeoutError, ConnectionError, OSError))
        or any(tok in lower_type for tok in _NETWORK_EXCEPTION_NAMES)
        or any(
            token in lower_msg
            for token in (
                "timed out",
                "timeout",
                "connection reset",
                "connection refused",
                "connection aborted",
                "name or service not known",
                "temporary failure in name resolution",
                "network is unreachable",
                "dns",
                "ssl",
            )
        )
    ):
        return {
            "error_type": error_type,
            "http_status": http_status,
            "google_status": google_status,
            "error_category": "network_error",
            "connectivity_status": "network_error",
            "retryable": True,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_network_error",
            "user_message": "Network or timeout error communicating with the Gemini AI service. Please try again shortly.",
            "diagnostic_message": diagnostic_message,
        }

    # 7. Upstream server overload / transient 5xx
    if (
        (http_status is not None and 500 <= http_status <= 599)
        or google_status in ("UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED")
        or error_type in ("ServerError", "ServiceUnavailable", "InternalServerError")
        or any(
            token in lower_msg
            for token in (
                "overloaded",
                "unavailable",
                "try again later",
                "service error",
                "internal error",
                "deadline exceeded",
                "capacity",
                "high demand",
            )
        )
    ):
        return {
            "error_type": error_type,
            "http_status": http_status or 503,
            "google_status": google_status or "UNAVAILABLE",
            "error_category": "service_overload",
            "connectivity_status": "service_overload",
            "retryable": True,
            "app_error_kind": "service_unavailable",
            "app_error_code": "ai_service_overloaded",
            "user_message": "The Gemini AI service is temporarily overloaded or unavailable. Please try again shortly.",
            "diagnostic_message": diagnostic_message,
        }

    # 8. Unclassified SDK / runtime error (non-retryable by default)
    return {
        "error_type": error_type,
        "http_status": http_status,
        "google_status": google_status,
        "error_category": "sdk_error",
        "connectivity_status": "error",
        "retryable": False,
        "app_error_kind": "service_unavailable",
        "app_error_code": "ai_sdk_error",
        "user_message": "The AI preparation service encountered an unexpected error. Please try again shortly.",
        "diagnostic_message": diagnostic_message,
    }


def compute_backoff_delay(
    attempt: int,
    *,
    base_delay: float = 0.75,
    max_delay: float = 6.0,
    rng: Callable[[float, float], float] = random.uniform,
) -> float:
    """Bounded exponential backoff with equal jitter (never exceeds max_delay)."""
    exponent = max(int(attempt), 0)
    ceiling = min(max_delay, base_delay * (2**exponent))
    floor = ceiling * 0.5
    return round(max(0.0, min(max_delay, rng(floor, ceiling))), 3)


def extract_finish_reason(response: Any) -> str:
    """Safely extract candidate[0].finish_reason from a GenerateContentResponse."""
    candidates = getattr(response, "candidates", None)
    if not candidates or not isinstance(candidates, (list, tuple)):
        return ""
    first = candidates[0]
    reason = getattr(first, "finish_reason", None)
    if reason is None:
        return ""
    if hasattr(reason, "name"):
        return str(reason.name)
    if hasattr(reason, "value"):
        return str(reason.value)
    return str(reason)


def parse_structured_json(raw_text: str | None, *, finish_reason: str = "") -> dict[str, Any]:
    """Validate non-empty JSON object output from a Gemini structured response."""
    cleaned = (raw_text or "").strip()
    upper_reason = (finish_reason or "").upper()

    if not cleaned:
        if "MAX_TOKENS" in upper_reason:
            raise MalformedAIResponseError(
                "Gemini output was exhausted by MAX_TOKENS before producing text.",
                reason_code="truncated_max_tokens",
                finish_reason=finish_reason,
            )
        if any(flag in upper_reason for flag in ("SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED")):
            raise MalformedAIResponseError(
                f"Gemini response was blocked ({finish_reason}).",
                reason_code="blocked_response",
                finish_reason=finish_reason,
            )
        raise MalformedAIResponseError(
            "Gemini returned an empty structured response.",
            reason_code="empty_response",
            finish_reason=finish_reason,
        )

    fence_match = _JSON_FENCE_RE.match(cleaned)
    if fence_match:
        cleaned = fence_match.group(1).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        reason_code = "truncated_max_tokens" if "MAX_TOKENS" in upper_reason else "invalid_json"
        raise MalformedAIResponseError(
            f"Malformed JSON from Gemini ({reason_code}): {exc.msg}",
            reason_code=reason_code,
            finish_reason=finish_reason,
        ) from exc

    if not isinstance(parsed, dict):
        raise MalformedAIResponseError(
            f"Expected JSON object from Gemini but received {type(parsed).__name__}.",
            reason_code="unexpected_json_type",
            finish_reason=finish_reason,
        )

    return parsed
