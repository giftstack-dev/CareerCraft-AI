"""Standardised error classes and JSON API response helpers."""

from __future__ import annotations

from typing import Any, Optional
from flask import jsonify


class AppError(Exception):
    """Base application error carrying safe user-facing message and status code."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        error_code: str = "bad_request",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}


class AuthError(AppError):
    def __init__(self, message: str = "Authentication required.", error_code: str = "unauthorized") -> None:
        super().__init__(message=message, status_code=401, error_code=error_code)


class ForbiddenError(AppError):
    def __init__(self, message: str = "You do not have permission to access this resource.", error_code: str = "forbidden") -> None:
        super().__init__(message=message, status_code=403, error_code=error_code)


class NotFoundError(AppError):
    def __init__(self, message: str = "Requested resource was not found.", error_code: str = "not_found") -> None:
        super().__init__(message=message, status_code=404, error_code=error_code)


class ValidationError(AppError):
    def __init__(self, message: str = "Invalid request data.", details: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message=message, status_code=422, error_code="validation_error", details=details)


class RateLimitError(AppError):
    def __init__(self, message: str = "Configured request limit reached. Please try again later.") -> None:
        super().__init__(message=message, status_code=429, error_code="rate_limit_exceeded")


class ServiceUnavailableError(AppError):
    def __init__(self, message: str = "A required service is temporarily unavailable.") -> None:
        super().__init__(message=message, status_code=503, error_code="service_unavailable")


def success_response(
    data: Any = None,
    message: str = "OK",
    status_code: int = 200,
):
    """Return a consistent JSON envelope for successful API responses."""
    payload = {
        "success": True,
        "data": data,
        "message": message,
        "error": None,
    }
    return jsonify(payload), status_code


def error_response(
    message: str,
    status_code: int = 400,
    error_code: str = "error",
    details: Optional[dict[str, Any]] = None,
):
    """Return a consistent, stack-trace-free JSON envelope for API errors."""
    error_obj: dict[str, Any] = {"code": error_code, "message": message}
    if details:
        error_obj["details"] = details
    payload = {
        "success": False,
        "data": None,
        "message": message,
        "error": error_obj,
    }
    return jsonify(payload), status_code
