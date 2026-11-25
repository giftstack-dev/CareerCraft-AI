"""System health, live dependency connectivity checks, and dashboard summary endpoints."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, current_app, request

from services.gemini_service import GeminiService
from services.supabase_service import get_secret_client
from utils.auth import require_auth
from utils.errors import error_response, success_response

dashboard_bp = Blueprint("dashboard", __name__)


def _http_get_json(url: str, headers: dict[str, str] | None = None, timeout: int = 8) -> tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - HTTPS URLs from validated config
        raw = resp.read().decode("utf-8", errors="replace")
        return resp.status, json.loads(raw) if raw else {}


def _probe_supabase_auth(cfg) -> dict[str, Any]:
    if not cfg.supabase_public_configured:
        return {"connected": False, "status": "unconfigured"}
    url = f"{cfg.SUPABASE_URL.rstrip('/')}/auth/v1/health"
    try:
        status_code, _ = _http_get_json(url, headers={"apikey": cfg.SUPABASE_PUBLISHABLE_KEY})
        return {"connected": status_code == 200, "status": "connected" if status_code == 200 else "error"}
    except urllib.error.HTTPError as exc:
        return {"connected": False, "status": "error", "http_status": exc.code}
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "status": "error", "error_type": type(exc).__name__}


def _probe_supabase_jwks(cfg) -> dict[str, Any]:
    jwks_url = cfg.resolved_jwks_url
    if not jwks_url:
        return {"connected": False, "status": "unconfigured"}
    try:
        status_code, payload = _http_get_json(jwks_url)
        keys = payload.get("keys", []) if isinstance(payload, dict) else []
        ok = status_code == 200 and len(keys) > 0
        return {
            "connected": ok,
            "status": "connected" if ok else "error",
            "key_count": len(keys),
        }
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "status": "error", "error_type": type(exc).__name__}


def _probe_supabase_database(cfg) -> dict[str, Any]:
    if not cfg.supabase_configured:
        return {"connected": False, "status": "unconfigured"}
    try:
        client = get_secret_client()
        client.table("profiles").select("id").limit(1).execute()
        return {"connected": True, "status": "connected", "schema_ready": True}
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "PGRST205" in msg or "schema cache" in msg.lower() or "does not exist" in msg.lower():
            return {
                "connected": False,
                "status": "schema_not_initialized",
                "schema_ready": False,
                "error_code": "PGRST205",
            }
        return {
            "connected": False,
            "status": "error",
            "schema_ready": False,
            "error_type": type(exc).__name__,
        }


def _probe_gemini_api(cfg, run_generation_check: bool = True) -> dict[str, Any]:
    if not cfg.gemini_configured:
        return {"connected": False, "status": "unconfigured", "model": cfg.GEMINI_MODEL}
    service = GeminiService(
        api_key=cfg.GEMINI_API_KEY,
        model=cfg.GEMINI_MODEL,
        timeout_seconds=cfg.AI_REQUEST_TIMEOUT,
    )
    return service.verify_connectivity(run_generation_check=run_generation_check)


def run_live_connectivity_checks(cfg, run_gemini_generation: bool = True) -> dict[str, Any]:
    """Execute actual connectivity probes against Supabase Auth, JWKS, DB, and Gemini."""
    auth_probe = _probe_supabase_auth(cfg)
    jwks_probe = _probe_supabase_jwks(cfg)
    db_probe = _probe_supabase_database(cfg)
    gemini_probe = _probe_gemini_api(cfg, run_generation_check=run_gemini_generation)

    all_connected = all(
        probe.get("connected") is True
        for probe in (auth_probe, jwks_probe, db_probe, gemini_probe)
    )
    return {
        "overall_status": "connected" if all_connected else "degraded",
        "supabase_auth": auth_probe,
        "supabase_jwks": jwks_probe,
        "supabase_database": db_probe,
        "gemini_api": gemini_probe,
    }


@dashboard_bp.get("/api/health")
def health_check():
    """Public health check reporting runtime readiness (plus live checks when ?deep=true)."""
    cfg = current_app.config["APP_CONFIG"]
    deep = request.args.get("deep", "").strip().lower() in ("1", "true", "yes")
    checks: dict[str, Any] = {
        "supabase_configured": cfg.supabase_configured,
        "gemini_configured": cfg.gemini_configured,
        "max_upload_size_mb": cfg.MAX_UPLOAD_SIZE_MB,
    }

    overall_status = "ok"
    if deep:
        live = run_live_connectivity_checks(cfg, run_gemini_generation=True)
        checks["live_connectivity"] = live
        if live["overall_status"] != "connected":
            overall_status = "degraded"

    return success_response(
        data={
            "status": overall_status,
            "service": "careercraft-ai-backend",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": checks,
        },
        message="CareerCraft AI backend is running.",
    )


@dashboard_bp.get("/api/health/connectivity")
def health_connectivity():
    """Verify actual live connectivity to Supabase Auth, JWKS, PostgreSQL, and Gemini API."""
    cfg = current_app.config["APP_CONFIG"]
    run_gen = request.args.get("mode", "full").strip().lower() != "light"
    live = run_live_connectivity_checks(cfg, run_gemini_generation=run_gen)
    return success_response(
        data={
            "status": live["overall_status"],
            "service": "careercraft-ai-backend",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "connectivity": live,
        },
        message=(
            "All live services connected."
            if live["overall_status"] == "connected"
            else "One or more backend services require setup or are unreachable."
        ),
    )


@dashboard_bp.get("/api/dashboard")
@require_auth(require_verified_email=True)
def get_dashboard():
    """Dashboard aggregation endpoint (implemented in Phase 3)."""
    return error_response(
        "Dashboard aggregation will be enabled in Phase 3.",
        status_code=501,
        error_code="not_implemented_phase_1",
    )
