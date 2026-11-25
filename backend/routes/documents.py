"""Application Studio Generation, Document Editor, Versioning & Binary Export Blueprint."""

from __future__ import annotations

import json
from typing import Any

from flask import Blueprint, Response, current_app, g, request
from pydantic import BaseModel, Field

from routes.jobs import (
    _summarize_confirmed_profile,
    run_compatibility_for_opportunity,
    run_job_analysis_for_opportunity,
)
from services.document_export_service import render_document_docx, render_document_pdf
from services.gemini_service import GeminiService
from services.grounding_service import verify_document_grounding
from services.profile_service import get_full_profile, handle_supabase_error, record_notification
from services.supabase_service import get_user_client
from services.usage_service import enforce_daily_ai_quota, record_usage
from utils.auth import require_auth
from utils.errors import AppError, NotFoundError, RateLimitError, ValidationError, success_response
from utils.security import sanitize_filename
from utils.validators import is_valid_uuid

documents_bp = Blueprint("documents", __name__, url_prefix="/api/documents")

VALID_DOC_TYPES = (
    "cv",
    "cover_letter",
    "screening_response",
    "personal_statement",
    "statement_of_purpose",
    "professional_bio",
    "other",
)
VALID_TEMPLATES = (
    "classic_professional",
    "modern_minimalist",
    "technical_engineering",
    "graduate_entry_level",
)
VALID_TONES = ("professional", "confident", "concise", "academic", "warm")


class DocHeaderSchema(BaseModel):
    full_name: str = ""
    headline: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    portfolio_url: str = ""


class DocEntrySchema(BaseModel):
    title: str = ""
    meta: str = ""
    description: str = ""
    bullets: list[str] = Field(default_factory=list)


class DocSectionSchema(BaseModel):
    heading: str = ""
    body: str = ""
    entries: list[DocEntrySchema] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)


class GeneratedDocContentSchema(BaseModel):
    document_title: str = ""
    header: DocHeaderSchema = Field(default_factory=DocHeaderSchema)
    summary: str = ""
    sections: list[DocSectionSchema] = Field(default_factory=list)
    paragraphs: list[str] = Field(default_factory=list)
    closing: str = ""
    grounding_notes: list[str] = Field(default_factory=list)


def _suggest_document_types(requested_docs: list[str], has_screening: bool) -> list[str]:
    joined = " ".join(str(x).lower() for x in requested_docs)
    chosen = ["cv"]
    if "cover" in joined or not requested_docs:
        chosen.append("cover_letter")
    if "personal statement" in joined:
        chosen.append("personal_statement")
    if "statement of purpose" in joined or "sop" in joined:
        chosen.append("statement_of_purpose")
    if "bio" in joined:
        chosen.append("professional_bio")
    if has_screening or "question" in joined:
        chosen.append("screening_response")
    return list(dict.fromkeys(chosen))


@documents_bp.post("/generate")
@require_auth(require_verified_email=True)
def generate_documents():
    """Generate tailored drafts grounded strictly in confirmed profile facts."""
    payload = request.get_json(silent=True) or {}
    user_id = g.current_user.user_id
    mode = str(payload.get("mode") or "guided").strip().lower()
    if mode not in ("quick", "guided"):
        raise ValidationError("Mode must be 'quick' or 'guided'.")

    template = str(payload.get("template") or "classic_professional").strip()
    if template not in VALID_TEMPLATES:
        raise ValidationError("Invalid CV template selection.")

    tone = str(payload.get("tone") or "professional").strip().lower()
    if tone not in VALID_TONES:
        tone = "professional"

    extra_context = str(payload.get("additional_context") or "").strip()[:2500]
    job_id = str(payload.get("job_opportunity_id") or "").strip() or None

    client = get_user_client()
    job_row = None
    analysis_row = None

    if job_id:
        if not is_valid_uuid(job_id):
            raise ValidationError("Invalid job_opportunity_id.")
        try:
            jr = client.table("job_opportunities").select("*").eq("id", job_id).eq("user_id", user_id).limit(1).execute()
            if not jr.data:
                raise NotFoundError("Job opportunity not found.")
            job_row = jr.data[0]
            ar = (
                client.table("job_analyses")
                .select("*")
                .eq("job_opportunity_id", job_id)
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            analysis_row = (ar.data or [None])[0]
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)

    profile_bundle = get_full_profile(user_id, client=client)
    profile_summary = _summarize_confirmed_profile(profile_bundle)
    if not (
        profile_summary.get("experience")
        or profile_summary.get("education")
        or profile_summary.get("skills")
        or profile_summary.get("projects")
        or profile_summary.get("professional_summary")
    ):
        raise ValidationError(
            "Add at least some confirmed career details (summary, experience, education, skills, or projects) before generating documents."
        )

    enforce_daily_ai_quota(user_id)

    auto_ran_steps: list[str] = []
    warnings: list[str] = []

    # Quick Generate pipeline: ensure job analysis + compatibility check are executed if missing
    if mode == "quick" and job_row is not None:
        if not analysis_row or not (analysis_row.get("structured_analysis") or {}):
            try:
                job_row, analysis_row = run_job_analysis_for_opportunity(
                    client=client,
                    user_id=user_id,
                    job_row=job_row,
                )
                auto_ran_steps.append("job_analysis")
            except RateLimitError:
                raise
            except AppError as exc:
                warnings.append(f"Automatic job analysis skipped ({exc.message}); generating from raw job description.")

        if not (analysis_row or {}).get("compatibility_results"):
            try:
                analysis_row, _ = run_compatibility_for_opportunity(
                    client=client,
                    user_id=user_id,
                    job_row=job_row,
                    analysis_row=analysis_row,
                    profile_bundle=profile_bundle,
                )
                auto_ran_steps.append("compatibility_check")
            except RateLimitError:
                raise
            except AppError as exc:
                warnings.append(f"Automatic compatibility check skipped ({exc.message}).")

    requested_types = payload.get("document_types")
    if mode == "quick" and (not isinstance(requested_types, list) or not requested_types):
        req_docs = ((analysis_row or {}).get("structured_analysis") or {}).get("requested_documents") or []
        has_qs = bool((job_row or {}).get("screening_questions"))
        doc_types = _suggest_document_types(req_docs, has_qs)
    else:
        if not isinstance(requested_types, list) or not requested_types:
            doc_types = ["cv"]
        else:
            doc_types = list(dict.fromkeys(str(t).strip() for t in requested_types if str(t).strip() in VALID_DOC_TYPES))
            if not doc_types:
                raise ValidationError("Select at least one valid document type.")

    cfg = current_app.config["APP_CONFIG"]
    service = GeminiService.from_app_config()

    created_docs: list[dict[str, Any]] = []
    failed_items: list[dict[str, str]] = []
    target_role = (job_row or {}).get("job_title") or "Target Role"
    target_company = (job_row or {}).get("company_name") or ""
    compat_results = (analysis_row or {}).get("compatibility_results") or {}

    for idx, doc_type in enumerate(doc_types):
        try:
            enforce_daily_ai_quota(user_id)
        except RateLimitError as exc:
            if created_docs:
                for skipped_type in doc_types[idx:]:
                    failed_items.append({"document_type": skipped_type, "reason": exc.message})
                warnings.append(exc.message)
                break
            raise

        task_instruction = (
            f"Generate a polished, recruitment-ready '{doc_type}' draft in a '{tone}' tone formatted cleanly for the '{template}' style. "
            "CRITICAL NON-FABRICATION RULE: You may ONLY use facts, employers, titles, dates, degrees, certifications, skills, projects, "
            "and achievements explicitly verified in CONFIRMED_PROFILE (or the user's ADDITIONAL_CONTEXT). "
            "NEVER invent metrics, percentages, employers, job titles, skills, tools, or degrees. "
            "Populate header fields from CONFIRMED_PROFILE contact details. For CVs, organize clear sections (Experience, Education, Skills, Projects, Certifications) using entries/bullets. "
            "For letters, statements, bios, or screening responses, write clear structured sections and/or paragraphs and closing. "
            "Include 1-3 factual grounding_notes stating which confirmed profile records supported this draft."
        )

        prompt_data = {
            "DOCUMENT_TYPE": doc_type,
            "TEMPLATE": template,
            "TONE": tone,
            "CONFIRMED_PROFILE": profile_summary,
            "TARGET_OPPORTUNITY": {
                "job_title": target_role,
                "company_name": target_company,
                "structured_analysis": (analysis_row or {}).get("structured_analysis") or {},
                "compatibility_highlights": {
                    "recommended_emphasis": compat_results.get("recommended_emphasis") or [],
                    "matching_skills": compat_results.get("matching_skills") or [],
                }
                if compat_results
                else {},
                "screening_questions": (job_row or {}).get("screening_questions") or [],
                "raw_excerpt": ((job_row or {}).get("original_job_description") or "")[:6000],
            },
            "ADDITIONAL_CONTEXT": extra_context,
        }

        try:
            res = service.generate_structured(
                task_instruction=task_instruction,
                user_payload=json.dumps(prompt_data, ensure_ascii=False),
                response_schema=GeneratedDocContentSchema,
            )
            generated = json.loads(res["text"])
            prof = profile_bundle.get("profile") or {}

            # Ensure header retains verified user contact fields
            header = generated.get("header") or {}
            header["full_name"] = prof.get("full_name") or header.get("full_name") or ""
            header["email"] = prof.get("email") or header.get("email") or ""
            if prof.get("phone"):
                header["phone"] = prof["phone"]
            if prof.get("city") or prof.get("country"):
                header["location"] = ", ".join(p for p in (prof.get("city"), prof.get("country")) if p)
            if prof.get("portfolio_url"):
                header["portfolio_url"] = prof["portfolio_url"]

            structured_content = {
                "header": header,
                "summary": generated.get("summary") or "",
                "sections": generated.get("sections") or [],
                "paragraphs": generated.get("paragraphs") or [],
                "closing": generated.get("closing") or "",
            }

            grounding_report = verify_document_grounding(
                structured_content=structured_content,
                doc_type=doc_type,
                profile_bundle=profile_bundle,
                job_row=job_row,
                analysis_row=analysis_row,
                extra_context=extra_context,
            )

            readable_type = doc_type.replace("_", " ").title()
            default_title = (
                f"{readable_type} — {target_role}" + (f" ({target_company})" if target_company else "")
                if job_row
                else f"{readable_type} Draft"
            )
            doc_title = str(generated.get("document_title") or default_title).strip()[:180]

            validation_info = {
                "grounded_in_confirmed_profile": grounding_report["verification_status"] == "verified",
                "verification_status": grounding_report["verification_status"],
                "grounding_notes": generated.get("grounding_notes") or [],
                "grounding_report": grounding_report,
                "tone": tone,
                "mode": mode,
                "auto_ran_steps": auto_ran_steps,
            }

            inserted_doc = client.table("generated_documents").insert(
                {
                    "user_id": user_id,
                    "job_opportunity_id": job_id,
                    "document_type": doc_type,
                    "document_title": doc_title,
                    "structured_content": structured_content,
                    "template": template,
                    "document_status": "draft",
                    "validation_info": validation_info,
                    "current_version": 1,
                }
            ).execute()
            doc_row = (inserted_doc.data or [{}])[0]

            if doc_row.get("id"):
                client.table("document_versions").insert(
                    {
                        "user_id": user_id,
                        "document_id": doc_row["id"],
                        "version_number": 1,
                        "content_snapshot": structured_content,
                        "template_snapshot": template,
                    }
                ).execute()
            created_docs.append(doc_row)

            usage = res.get("usage")
            record_usage(
                user_id=user_id,
                operation_type=f"generate_{doc_type}",
                ai_model=cfg.GEMINI_MODEL,
                request_status="success",
                prompt_tokens=getattr(usage, "prompt_token_count", None),
                completion_tokens=getattr(usage, "candidates_token_count", None),
                total_tokens=getattr(usage, "total_token_count", None),
            )
        except Exception as exc:
            record_usage(
                user_id=user_id,
                operation_type=f"generate_{doc_type}",
                ai_model=cfg.GEMINI_MODEL,
                request_status="failed",
            )
            if created_docs:
                err_msg = getattr(exc, "message", None) or "Generation failed for this document type."
                failed_items.append({"document_type": doc_type, "reason": err_msg})
                warnings.append(f"{doc_type.replace('_', ' ').title()}: {err_msg}")
                continue
            raise

    record_notification(
        user_id,
        "document_generated",
        f"Generated {len(created_docs)} application document draft(s).",
    )
    partial = len(failed_items) > 0
    msg = (
        f"Generated {len(created_docs)} draft(s) cleanly, while {len(failed_items)} item(s) could not be completed."
        if partial
        else f"Generated {len(created_docs)} tailored draft(s). Review grounding checks and approve before exporting."
    )
    return success_response(
        data={
            "items": created_docs,
            "failed_items": failed_items,
            "partial": partial,
            "warnings": warnings,
            "auto_ran_steps": auto_ran_steps,
            "compatibility": compat_results or None,
        },
        message=msg,
        status_code=207 if partial else 201,
    )


@documents_bp.get("")
@require_auth(require_verified_email=True)
def list_documents():
    user_id = g.current_user.user_id
    doc_type = request.args.get("document_type", "").strip()
    doc_status = request.args.get("document_status", "").strip()
    search = request.args.get("search", "").strip().lower()
    job_id = request.args.get("job_opportunity_id", "").strip()

    try:
        query = (
            get_user_client()
            .table("generated_documents")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
        )
        if doc_type in VALID_DOC_TYPES:
            query = query.eq("document_type", doc_type)
        if doc_status in ("draft", "reviewed", "approved"):
            query = query.eq("document_status", doc_status)
        if job_id and is_valid_uuid(job_id):
            query = query.eq("job_opportunity_id", job_id)
        res = query.execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    items = res.data or []
    if search:
        items = [
            item
            for item in items
            if search in str(item.get("document_title") or "").lower()
            or search in str(item.get("document_type") or "").lower()
        ]
    return success_response(data={"items": items}, message="Documents loaded.")


@documents_bp.route("/<doc_id>", methods=["GET", "PUT", "DELETE"])
@require_auth(require_verified_email=True)
def document_detail(doc_id: str):
    if not is_valid_uuid(doc_id):
        raise ValidationError("Invalid document ID.")
    user_id = g.current_user.user_id
    client = get_user_client()

    if request.method == "DELETE":
        try:
            res = client.table("generated_documents").delete().eq("id", doc_id).eq("user_id", user_id).execute()
        except Exception as exc:  # noqa: BLE001
            handle_supabase_error(exc)
        if not res.data:
            raise NotFoundError("Document not found.")
        return success_response(data={"deleted_id": doc_id}, message="Document deleted.")

    try:
        existing_res = client.table("generated_documents").select("*").eq("id", doc_id).eq("user_id", user_id).limit(1).execute()
        if not existing_res.data:
            raise NotFoundError("Document not found.")
        current_doc = existing_res.data[0]
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    if request.method == "GET":
        return success_response(data={"item": current_doc}, message="Document loaded.")

    payload = request.get_json(silent=True) or {}
    updates: dict[str, Any] = {}

    if "document_title" in payload:
        title = str(payload.get("document_title") or "").strip()[:180]
        if not title:
            raise ValidationError("Document title cannot be empty.")
        updates["document_title"] = title

    if "template" in payload:
        tpl = str(payload.get("template") or "").strip()
        if tpl not in VALID_TEMPLATES:
            raise ValidationError("Invalid template selection.")
        updates["template"] = tpl

    if "document_status" in payload:
        st = str(payload.get("document_status") or "").strip()
        if st not in ("draft", "reviewed", "approved"):
            raise ValidationError("Invalid document_status.")
        updates["document_status"] = st

    create_version = False
    if "structured_content" in payload:
        if not isinstance(payload.get("structured_content"), dict):
            raise ValidationError("structured_content must be a JSON object.")
        updates["structured_content"] = payload["structured_content"]
        create_version = True
    elif "template" in updates and updates["template"] != current_doc.get("template"):
        create_version = True

    if not updates:
        raise ValidationError("No valid document updates provided.")

    if create_version:
        next_version = int(current_doc.get("current_version") or 1) + 1
        updates["current_version"] = next_version
        if "document_status" not in updates and current_doc.get("document_status") == "draft":
            updates["document_status"] = "reviewed"

    try:
        updated_res = client.table("generated_documents").update(updates).eq("id", doc_id).eq("user_id", user_id).execute()
        updated_doc = (updated_res.data or [current_doc])[0]
        if create_version:
            client.table("document_versions").insert(
                {
                    "user_id": user_id,
                    "document_id": doc_id,
                    "version_number": updated_doc["current_version"],
                    "content_snapshot": updated_doc["structured_content"],
                    "template_snapshot": updated_doc["template"],
                }
            ).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(data={"item": updated_doc}, message="Document saved.")


@documents_bp.post("/<doc_id>/approve")
@require_auth(require_verified_email=True)
def approve_document(doc_id: str):
    if not is_valid_uuid(doc_id):
        raise ValidationError("Invalid document ID.")
    user_id = g.current_user.user_id
    try:
        res = (
            get_user_client()
            .table("generated_documents")
            .update({"document_status": "approved"})
            .eq("id", doc_id)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Document not found.")
    return success_response(data={"item": res.data[0]}, message="Document approved for use.")


@documents_bp.get("/<doc_id>/versions")
@require_auth(require_verified_email=True)
def list_document_versions(doc_id: str):
    if not is_valid_uuid(doc_id):
        raise ValidationError("Invalid document ID.")
    user_id = g.current_user.user_id
    try:
        res = (
            get_user_client()
            .table("document_versions")
            .select("*")
            .eq("document_id", doc_id)
            .eq("user_id", user_id)
            .order("version_number", desc=True)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={"items": res.data or []}, message="Document versions loaded.")


@documents_bp.post("/<doc_id>/restore")
@require_auth(require_verified_email=True)
def restore_document_version(doc_id: str):
    if not is_valid_uuid(doc_id):
        raise ValidationError("Invalid document ID.")
    payload = request.get_json(silent=True) or {}
    try:
        version_number = int(payload.get("version_number"))
    except (TypeError, ValueError) as exc:
        raise ValidationError("Valid version_number is required.") from exc

    user_id = g.current_user.user_id
    client = get_user_client()
    try:
        doc_res = client.table("generated_documents").select("*").eq("id", doc_id).eq("user_id", user_id).limit(1).execute()
        if not doc_res.data:
            raise NotFoundError("Document not found.")
        current_doc = doc_res.data[0]

        ver_res = (
            client.table("document_versions")
            .select("*")
            .eq("document_id", doc_id)
            .eq("user_id", user_id)
            .eq("version_number", version_number)
            .limit(1)
            .execute()
        )
        if not ver_res.data:
            raise NotFoundError("Requested version snapshot was not found.")
        snap = ver_res.data[0]

        next_version = int(current_doc.get("current_version") or 1) + 1
        updated_res = (
            client.table("generated_documents")
            .update(
                {
                    "structured_content": snap["content_snapshot"],
                    "template": snap["template_snapshot"],
                    "current_version": next_version,
                }
            )
            .eq("id", doc_id)
            .eq("user_id", user_id)
            .execute()
        )
        client.table("document_versions").insert(
            {
                "user_id": user_id,
                "document_id": doc_id,
                "version_number": next_version,
                "content_snapshot": snap["content_snapshot"],
                "template_snapshot": snap["template_snapshot"],
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    return success_response(
        data={"item": (updated_res.data or [current_doc])[0]},
        message=f"Restored version {version_number} as version {next_version}.",
    )


@documents_bp.route("/<doc_id>/export", methods=["POST", "GET"])
@require_auth(require_verified_email=True)
def export_document(doc_id: str):
    """Export document as genuine binary PDF or DOCX file."""
    if not is_valid_uuid(doc_id):
        raise ValidationError("Invalid document ID.")

    payload = request.get_json(silent=True) or {}
    fmt = str(request.args.get("format") or payload.get("format") or "pdf").strip().lower()
    if fmt not in ("pdf", "docx"):
        raise ValidationError("Export format must be 'pdf' or 'docx'.")

    user_id = g.current_user.user_id
    try:
        res = (
            get_user_client()
            .table("generated_documents")
            .select("*")
            .eq("id", doc_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    if not res.data:
        raise NotFoundError("Document not found.")

    doc_row = res.data[0]
    safe_base = sanitize_filename(doc_row.get("document_title") or "CareerCraft_Document", fallback="CareerCraft_Document")
    if safe_base.lower().endswith((".pdf", ".docx")):
        safe_base = safe_base.rsplit(".", 1)[0]

    if fmt == "pdf":
        binary_data = render_document_pdf(doc_row)
        mime = "application/pdf"
        filename = f"{safe_base}.pdf"
    else:
        binary_data = render_document_docx(doc_row)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = f"{safe_base}.docx"

    return Response(
        binary_data,
        status=200,
        mimetype=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
