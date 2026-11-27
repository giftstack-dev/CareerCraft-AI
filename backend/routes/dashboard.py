"""System health, live dependency connectivity checks, and real dashboard aggregation."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, current_app, g, request

from services.gemini_service import GeminiService
from services.profile_service import get_full_profile, handle_supabase_error
from services.supabase_service import check_supabase_sdk_compatibility, get_secret_client, get_user_client
from utils.auth import require_auth
from utils.errors import success_response

logger = logging.getLogger(__name__)
dashboard_bp = Blueprint("dashboard", __name__)

APPLICATION_STATUSES = [
    "Saved",
    "Preparing",
    "Applied",
    "Interview",
    "Assessment",
    "Offer Received",
    "Not Selected",
]


def _http_get_json(url: str, headers: dict[str, str] | None = None, timeout: int = 8) -> tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
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
    compat = check_supabase_sdk_compatibility(cfg)
    try:
        client = get_secret_client()
        client.table("profiles").select("id").limit(1).execute()
        return {
            "connected": True,
            "status": "connected",
            "schema_ready": True,
            "sdk_version": compat["sdk_version"],
            "sdk_compatible": compat["sdk_compatible"],
        }
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        lower = msg.lower()
        if "pgrst205" in lower or "schema cache" in lower or "does not exist" in lower:
            return {
                "connected": False,
                "status": "schema_not_initialized",
                "schema_ready": False,
                "error_code": "PGRST205",
                "sdk_version": compat["sdk_version"],
                "sdk_compatible": compat["sdk_compatible"],
            }
        if "invalid api key" in lower or "apikey" in lower or "pgrst301" in lower:
            return {
                "connected": False,
                "status": "key_or_sdk_error",
                "schema_ready": False,
                "error_code": "supabase_key_error",
                "sdk_version": compat["sdk_version"],
                "sdk_compatible": compat["sdk_compatible"],
            }
        return {
            "connected": False,
            "status": "error",
            "schema_ready": False,
            "error_type": type(exc).__name__,
            "sdk_version": compat["sdk_version"],
            "sdk_compatible": compat["sdk_compatible"],
        }


def _probe_gemini_api(cfg, run_generation_check: bool = True) -> dict[str, Any]:
    if not cfg.gemini_configured:
        return {"connected": False, "status": "unconfigured", "model": cfg.GEMINI_MODEL}
    try:
        service = GeminiService(
            api_key=cfg.GEMINI_API_KEY,
            model=cfg.GEMINI_MODEL,
            timeout_seconds=cfg.AI_REQUEST_TIMEOUT,
        )
        return service.verify_connectivity(run_generation_check=run_generation_check)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini probe raised unexpected error safely: %s", type(exc).__name__)
        return {
            "connected": False,
            "status": "error",
            "model": cfg.GEMINI_MODEL,
            "generation_verified": False,
            "error_type": type(exc).__name__,
        }


def _safe_probe(fn, *args, **kwargs) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Connectivity probe %s failed safely: %s", getattr(fn, "__name__", "probe"), type(exc).__name__)
        return {"connected": False, "status": "error", "error_type": type(exc).__name__}


def run_live_connectivity_checks(cfg, run_gemini_generation: bool = True) -> dict[str, Any]:
    """Execute actual connectivity probes against Supabase Auth, JWKS, DB, and Gemini."""
    auth_probe = _safe_probe(_probe_supabase_auth, cfg)
    jwks_probe = _safe_probe(_probe_supabase_jwks, cfg)
    db_probe = _safe_probe(_probe_supabase_database, cfg)
    gemini_probe = _safe_probe(_probe_gemini_api, cfg, run_generation_check=run_gemini_generation)

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
    """Aggregate real authenticated user metrics, status summaries, and activity."""
    user_id = g.current_user.user_id
    full_profile = get_full_profile(user_id)
    client = get_user_client()

    try:
        jobs_res = (
            client.table("job_opportunities")
            .select("id, company_name, job_title, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        docs_res = (
            client.table("generated_documents")
            .select("id, document_title, document_type, document_status, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        apps_res = (
            client.table("applications")
            .select("id, company_name, job_title, status, application_date, interview_date, follow_up_date, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        cvs_res = (
            client.table("uploaded_cvs")
            .select("id, original_filename, parsing_status, confirmation_status, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        notif_res = (
            client.table("notifications")
            .select("id, notification_type, message, is_read, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(8)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    jobs = jobs_res.data or []
    docs = docs_res.data or []
    apps = apps_res.data or []
    cvs = cvs_res.data or []
    notifications = notif_res.data or []

    status_counts = {status: 0 for status in APPLICATION_STATUSES}
    upcoming_interviews = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for app_item in apps:
        st = app_item.get("status")
        if st in status_counts:
            status_counts[st] += 1
        interview_dt = app_item.get("interview_date")
        if interview_dt and str(interview_dt) >= now_iso:
            upcoming_interviews.append(app_item)

    upcoming_interviews.sort(key=lambda item: str(item.get("interview_date") or ""))

    # Build chronological recent activity from real persisted events
    activity: list[dict[str, str]] = []
    for n in notifications:
        activity.append(
            {
                "type": str(n.get("notification_type") or "activity"),
                "message": str(n.get("message") or ""),
                "timestamp": str(n.get("created_at") or ""),
            }
        )
    for d in docs[:4]:
        activity.append(
            {
                "type": "document",
                "message": f"Updated document: {d.get('document_title')} ({d.get('document_status')})",
                "timestamp": str(d.get("updated_at") or ""),
            }
        )
    for j in jobs[:4]:
        title = j.get("job_title") or "Untitled Role"
        company = j.get("company_name") or "Target Employer"
        activity.append(
            {
                "type": "job_opportunity",
                "message": f"Saved opportunity: {title} — {company}",
                "timestamp": str(j.get("created_at") or ""),
            }
        )
    for cv in cvs[:3]:
        activity.append(
            {
                "type": "cv_upload",
                "message": f"Uploaded CV: {cv.get('original_filename')} ({cv.get('parsing_status')})",
                "timestamp": str(cv.get("created_at") or ""),
            }
        )

    activity.sort(key=lambda item: item.get("timestamp") or "", reverse=True)

    return success_response(
        data={
            "profile": full_profile["profile"],
            "completion": full_profile["completion"],
            "counts": {
                "saved_opportunities": len(jobs),
                "generated_documents": len(docs),
                "recorded_applications": len(apps),
                "uploaded_cvs": len(cvs),
            },
            "application_status_summary": status_counts,
            "recent_applications": apps[:5],
            "upcoming_interviews": upcoming_interviews[:5],
            "recent_documents": docs[:4],
            "recent_activity": activity[:8],
        },
        message="Dashboard metrics loaded.",
    )
