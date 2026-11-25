"""Interview Preparation Blueprint (Grounded in Confirmed Profile & Job Opportunity)."""

from __future__ import annotations

import json
from typing import Any

from flask import Blueprint, current_app, g, request
from pydantic import BaseModel, Field

from routes.jobs import _summarize_confirmed_profile
from services.gemini_service import GeminiService
from services.profile_service import get_full_profile, handle_supabase_error, record_notification
from services.supabase_service import get_secret_client
from services.usage_service import enforce_daily_ai_quota, record_usage
from utils.auth import require_auth
from utils.errors import NotFoundError, ValidationError, success_response
from utils.validators import is_valid_uuid

interviews_bp = Blueprint("interviews", __name__, url_prefix="/api/interviews")


class InterviewQuestionItem(BaseModel):
    id: str
    category: str  # general | role_specific | technical | behavioral
    question: str
    suggested_structure: str
    star_guidance: str
    grounded_profile_reference: str = ""


class InterviewPrepSchema(BaseModel):
    general: list[InterviewQuestionItem] = Field(default_factory=list)
    role_specific: list[InterviewQuestionItem] = Field(default_factory=list)
    technical: list[InterviewQuestionItem] = Field(default_factory=list)
    behavioral: list[InterviewQuestionItem] = Field(default_factory=list)


def _flatten_questions(structured: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    idx = 1
    for cat in ("general", "role_specific", "technical", "behavioral"):
        for item in structured.get(cat) or []:
            q_text = str(item.get("question") or "").strip()
            if not q_text:
                continue
            qid = str(item.get("id") or f"q_{idx}").strip()[:40]
            flattened.append(
                {
                    "id": qid,
                    "category": cat,
                    "question": q_text,
                    "suggested_structure": str(item.get("suggested_structure") or "").strip(),
                    "star_guidance": str(item.get("star_guidance") or "").strip(),
                    "grounded_profile_reference": str(item.get("grounded_profile_reference") or "").strip(),
                }
            )
            idx += 1
    return flattened


@interviews_bp.post("/generate")
@require_auth(require_verified_email=True)
def generate_interview_prep():
    payload = request.get_json(silent=True) or {}
    job_id = str(payload.get("job_opportunity_id") or "").strip()
    if not is_valid_uuid(job_id):
        raise ValidationError("Select a valid saved job opportunity first.")

    user_id = g.current_user.user_id
    client = get_secret_client()
    try:
        job_res = (
            client.table("job_opportunities")
            .select("*")
            .eq("id", job_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not job_res.data:
            raise NotFoundError("Job opportunity not found.")
        job_row = job_res.data[0]

        ana_res = (
            client.table("job_analyses")
            .select("*")
            .eq("job_opportunity_id", job_id)
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        analysis_row = (ana_res.data or [None])[0]
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    profile_summary = _summarize_confirmed_profile(get_full_profile(user_id))
    enforce_daily_ai_quota(user_id)
    cfg = current_app.config["APP_CONFIG"]
    service = GeminiService.from_app_config()

    task_instruction = (
        "Generate a structured, realistic interview preparation set tailored to the target job opportunity and the user's CONFIRMED_PROFILE. "
        "Include 2-3 questions per category: general, role_specific, technical, and behavioral. "
        "Assign unique short IDs (e.g. gen_1, role_1, tech_1, beh_1) and set category to match the array name. "
        "For each question, provide concise suggested_structure and practical STAR (Situation, Task, Action, Result) guidance. "
        "CRITICAL: In star_guidance and grounded_profile_reference, cite ONLY real experiences, projects, education, or skills present in CONFIRMED_PROFILE. "
        "If the profile has limited evidence for a topic, advise the user on how to frame honest transferable preparation without inventing claims."
    )

    user_payload = json.dumps(
        {
            "CONFIRMED_PROFILE": profile_summary,
            "JOB_OPPORTUNITY": {
                "job_title": job_row.get("job_title"),
                "company_name": job_row.get("company_name"),
                "structured_analysis": (analysis_row or {}).get("structured_analysis") or {},
                "job_description_excerpt": (job_row.get("original_job_description") or "")[:7000],
            },
        },
        ensure_ascii=False,
    )

    try:
        res = service.generate_structured(
            task_instruction=task_instruction,
            user_payload=user_payload,
            response_schema=InterviewPrepSchema,
        )
        structured = json.loads(res["text"])
        questions = _flatten_questions(structured)

        inserted = client.table("interview_sessions").insert(
            {
                "user_id": user_id,
                "job_opportunity_id": job_id,
                "questions": questions,
                "practice_answers": {},
            }
        ).execute()
        session_row = (inserted.data or [{}])[0]
        session_row["job_title"] = job_row.get("job_title")
        session_row["company_name"] = job_row.get("company_name")

        usage = res.get("usage")
        record_usage(
            user_id=user_id,
            operation_type="interview_prep",
            ai_model=cfg.GEMINI_MODEL,
            request_status="success",
            prompt_tokens=getattr(usage, "prompt_token_count", None),
            completion_tokens=getattr(usage, "candidates_token_count", None),
            total_tokens=getattr(usage, "total_token_count", None),
        )
        record_notification(
            user_id,
            "interview_prep",
            f"Prepared interview questions for {job_row.get('job_title') or 'target role'}.",
        )
    except Exception:
        record_usage(
            user_id=user_id,
            operation_type="interview_prep",
            ai_model=cfg.GEMINI_MODEL,
            request_status="failed",
        )
        raise

    return success_response(
        data={"item": session_row},
        message="Interview preparation session generated.",
        status_code=201,
    )


@interviews_bp.get("")
@require_auth(require_verified_email=True)
def list_interviews():
    user_id = g.current_user.user_id
    client = get_secret_client()
    try:
        sess_res = (
            client.table("interview_sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        jobs_res = (
            client.table("job_opportunities")
            .select("id, job_title, company_name")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    job_map = {j["id"]: j for j in (jobs_res.data or [])}
    items = []
    for row in sess_res.data or []:
        copy = dict(row)
        job = job_map.get(row.get("job_opportunity_id")) or {}
        copy["job_title"] = job.get("job_title") or "Target Role"
        copy["company_name"] = job.get("company_name") or ""
        items.append(copy)

    return success_response(data={"items": items}, message="Interview sessions loaded.")


@interviews_bp.route("/<session_id>", methods=["GET", "PUT", "DELETE"])
@require_auth(require_verified_email=True)
def interview_detail(session_id: str):
    if not is_valid_uuid(session_id):
        raise ValidationError("Invalid interview session ID.")
    user_id = g.current_user.user_id
    client = get_secret_client()

    if request.method == "DELETE":
        try:
            res = client.table("interview_sessions").delete().eq("id", session_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Interview session not found.")
        return success_response(data={"deleted_id": session_id}, message="Interview session deleted.")

    try:
        res = (
            client.table("interview_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            raise NotFoundError("Interview session not found.")
        session_row = res.data[0]
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    if request.method == "GET":
        return success_response(data={"item": session_row}, message="Interview session loaded.")

    payload = request.get_json(silent=True) or {}
    answers = payload.get("practice_answers")
    if not isinstance(answers, dict):
        raise ValidationError("practice_answers must be a JSON object.")

    cleaned_answers = {
        str(k).strip()[:40]: str(v or "").strip()[:5000]
        for k, v in answers.items()
        if str(k).strip()
    }
    try:
        updated = (
            client.table("interview_sessions")
            .update({"practice_answers": cleaned_answers})
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(
        data={"item": (updated.data or [session_row])[0]},
        message="Practice answers saved.",
    )
