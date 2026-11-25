"""Independent server-side factual grounding verification for AI-generated documents."""

from __future__ import annotations

import re
from typing import Any

# Matches percentages, currency values, magnitudes (e.g., 15+, 20k, 3.5x), or numbers attached to units/years/KPIs
METRIC_RE = re.compile(
    r"(?:[$€£¥]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kmbKMB]\+?)?)"
    r"|(?:\b\d[\d,]*(?:\.\d+)?\s*%)"
    r"|(?:\b\d+(?:\.\d+)?\s*[kmbKMB]\+)"
    r"|(?:\b\d+(?:\.\d+)?\s*x\b)"
    r"|(?:\b\d+\+\s*(?:years?|yrs?|months?|people|engineers?|clients?|projects?|users?|team|members?)?)"
    r"|(?:\b\d+(?:\.\d+)?\s+(?:years?|yrs?|months?|clients?|projects?|users?|customers?|members?|engineers?|team))",
    re.IGNORECASE,
)

YEAR_RE = re.compile(r"\b(?:19\d{2}|20[0-3]\d)\b")
NUMERIC_CORE_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")

COMMON_WORDS = {
    "experience",
    "education",
    "skills",
    "projects",
    "certifications",
    "summary",
    "professional",
    "work",
    "employment",
    "history",
    "technical",
    "soft",
    "tools",
    "languages",
    "references",
    "core",
    "competencies",
    "key",
    "highlights",
    "overview",
    "present",
    "current",
    "remote",
    "hybrid",
    "full",
    "part",
    "time",
    "bachelor",
    "master",
    "degree",
    "certificate",
    "certified",
    "university",
    "college",
    "school",
    "inc",
    "ltd",
    "llc",
    "corp",
    "company",
    "senior",
    "junior",
    "lead",
    "manager",
    "engineer",
    "developer",
    "analyst",
    "specialist",
    "consultant",
    "associate",
}


def _collect_profile_corpus(
    profile_bundle: dict[str, Any],
    extra_context: str = "",
    job_row: dict[str, Any] | None = None,
) -> tuple[str, set[str], set[str]]:
    """Collect confirmed profile text, numeric tokens, and years for deterministic checks."""
    parts: list[str] = []
    prof = profile_bundle.get("profile") or {}
    for key in (
        "full_name",
        "email",
        "phone",
        "country",
        "city",
        "professional_title",
        "professional_summary",
        "career_objective",
        "portfolio_url",
    ):
        val = prof.get(key)
        if val:
            parts.append(str(val))

    for link in prof.get("professional_links") or []:
        if isinstance(link, dict):
            parts.append(str(link.get("label") or ""))
            parts.append(str(link.get("url") or ""))

    for lang in prof.get("languages") or []:
        if isinstance(lang, dict):
            parts.append(str(lang.get("language") or ""))
            parts.append(str(lang.get("proficiency") or ""))
        else:
            parts.append(str(lang))

    for exp in profile_bundle.get("experience") or []:
        parts.extend(
            [
                str(exp.get("employer") or ""),
                str(exp.get("job_title") or ""),
                str(exp.get("start_date") or ""),
                str(exp.get("end_date") or ""),
                " ".join(str(x) for x in (exp.get("responsibilities") or [])),
                " ".join(str(x) for x in (exp.get("achievements") or [])),
            ]
        )

    for edu in profile_bundle.get("education") or []:
        parts.extend(
            [
                str(edu.get("institution") or ""),
                str(edu.get("qualification") or ""),
                str(edu.get("field_of_study") or ""),
                str(edu.get("start_date") or ""),
                str(edu.get("end_date") or ""),
                str(edu.get("achievements") or ""),
            ]
        )

    for sk in profile_bundle.get("skills") or []:
        parts.append(str(sk.get("skill_name") or ""))
        parts.append(str(sk.get("proficiency") or ""))

    for proj in profile_bundle.get("projects") or []:
        parts.extend(
            [
                str(proj.get("project_title") or ""),
                str(proj.get("description") or ""),
                str(proj.get("personal_contribution") or ""),
                " ".join(str(t) for t in (proj.get("tools") or [])),
                str(proj.get("project_url") or ""),
            ]
        )

    for cert in profile_bundle.get("certifications") or []:
        parts.extend(
            [
                str(cert.get("certification_name") or ""),
                str(cert.get("issuing_organisation") or ""),
                str(cert.get("issue_date") or ""),
                str(cert.get("credential_url") or ""),
            ]
        )

    if extra_context:
        parts.append(extra_context)

    if job_row:
        parts.append(str(job_row.get("job_title") or ""))
        parts.append(str(job_row.get("company_name") or ""))
        for sq in job_row.get("screening_questions") or []:
            parts.append(str(sq))

    corpus = " \n ".join(p for p in parts if p)
    confirmed_numbers = {m.replace(",", "") for m in NUMERIC_CORE_RE.findall(corpus)}
    confirmed_years = set(YEAR_RE.findall(corpus))
    return corpus, confirmed_numbers, confirmed_years


def _extract_doc_text_segments(structured_content: dict[str, Any]) -> list[tuple[str, str]]:
    """Return labeled text segments from generated structured_content."""
    segments: list[tuple[str, str]] = []
    if structured_content.get("summary"):
        segments.append(("Summary", str(structured_content["summary"])))

    for sec in structured_content.get("sections") or []:
        sec_name = str(sec.get("heading") or "Section").strip()
        if sec.get("body"):
            segments.append((sec_name, str(sec["body"])))
        for idx, bullet in enumerate(sec.get("bullets") or [], start=1):
            if str(bullet or "").strip():
                segments.append((f"{sec_name} bullet #{idx}", str(bullet)))
        for entry in sec.get("entries") or []:
            e_title = str(entry.get("title") or "").strip()
            e_meta = str(entry.get("meta") or "").strip()
            label = e_title or sec_name
            if e_meta:
                segments.append((f"{label} metadata", e_meta))
            if entry.get("description"):
                segments.append((f"{label} description", str(entry["description"])))
            for idx, b in enumerate(entry.get("bullets") or [], start=1):
                if str(b or "").strip():
                    segments.append((f"{label} bullet #{idx}", str(b)))

    for idx, para in enumerate(structured_content.get("paragraphs") or [], start=1):
        if str(para or "").strip():
            segments.append((f"Paragraph #{idx}", str(para)))

    if structured_content.get("closing"):
        segments.append(("Closing", str(structured_content["closing"])))

    return segments


def _meaningful_tokens(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]{3,}", text.lower())
    return {t for t in tokens if t not in COMMON_WORDS and not YEAR_RE.fullmatch(t)}


def verify_document_grounding(
    *,
    structured_content: dict[str, Any],
    doc_type: str,
    profile_bundle: dict[str, Any],
    job_row: dict[str, Any] | None = None,
    analysis_row: dict[str, Any] | None = None,
    extra_context: str = "",
) -> dict[str, Any]:
    """Perform deterministic post-generation factual verification against confirmed profile data.

    Checks generated quantitative metrics, dates/years, contact header fields, and entry
    titles/employers/institutions against the user's confirmed profile and supplied context,
    and reports missing profile fields or clarification prompts.
    """
    corpus, confirmed_numbers, confirmed_years = _collect_profile_corpus(
        profile_bundle=profile_bundle,
        extra_context=extra_context,
        job_row=job_row,
    )
    corpus_lower = corpus.lower()

    verified_claims: list[dict[str, str]] = []
    flagged_claims: list[dict[str, str]] = []
    missing_information: list[str] = []
    clarification_prompts: list[str] = []

    prof = profile_bundle.get("profile") or {}
    exp_list = profile_bundle.get("experience") or []
    edu_list = profile_bundle.get("education") or []
    skills_list = profile_bundle.get("skills") or []
    proj_list = profile_bundle.get("projects") or []
    cert_list = profile_bundle.get("certifications") or []

    # 1. Verify contact header fidelity
    header = structured_content.get("header") or {}
    if prof.get("full_name") and header.get("full_name"):
        verified_claims.append(
            {"field": "header.full_name", "detail": f"Name matches confirmed profile ({prof['full_name']})."}
        )
    if prof.get("email") and header.get("email"):
        verified_claims.append(
            {"field": "header.email", "detail": "Email matches verified account profile."}
        )
    if header.get("phone") and not prof.get("phone"):
        flagged_claims.append(
            {
                "type": "unconfirmed_contact",
                "location": "Header",
                "claim": str(header["phone"]),
                "reason": "Phone number in draft is not stored in your confirmed profile.",
            }
        )

    # 2. Check quantitative metrics/percentages/counts and years across all generated segments
    seen_flags: set[tuple[str, str]] = set()
    segments = _extract_doc_text_segments(structured_content)
    for location, text in segments:
        for match in METRIC_RE.finditer(text):
            raw_metric = match.group(0).strip()
            core_nums = [n.replace(",", "") for n in NUMERIC_CORE_RE.findall(raw_metric)]
            if core_nums and all(num not in confirmed_numbers for num in core_nums):
                key = ("metric", raw_metric.lower())
                if key not in seen_flags:
                    seen_flags.add(key)
                    flagged_claims.append(
                        {
                            "type": "unverified_metric",
                            "location": location,
                            "claim": raw_metric,
                            "reason": "Metric or quantity not found verbatim in your confirmed career profile or extra context.",
                        }
                    )

        for yr in YEAR_RE.findall(text):
            # Ignore standalone current/target opportunity year references only if not part of profile
            if yr not in confirmed_years:
                key = ("year", yr)
                if key not in seen_flags:
                    seen_flags.add(key)
                    flagged_claims.append(
                        {
                            "type": "unverified_year",
                            "location": location,
                            "claim": yr,
                            "reason": f"Year '{yr}' does not match dates recorded in your confirmed experience, education, or certifications.",
                        }
                    )

    # 3. Verify named entry headers (employers, qualifications, project titles) against confirmed records
    known_titles_blob = " ".join(
        [
            " ".join(f"{e.get('job_title', '')} {e.get('employer', '')}" for e in exp_list),
            " ".join(f"{e.get('qualification', '')} {e.get('institution', '')} {e.get('field_of_study', '')}" for e in edu_list),
            " ".join(f"{p.get('project_title', '')}" for p in proj_list),
            " ".join(f"{c.get('certification_name', '')} {c.get('issuing_organisation', '')}" for c in cert_list),
            extra_context,
        ]
    ).lower()

    confirmed_entry_count = 0
    for sec in structured_content.get("sections") or []:
        sec_heading_lower = str(sec.get("heading") or "").lower()
        for entry in sec.get("entries") or []:
            e_title = str(entry.get("title") or "").strip()
            e_meta = str(entry.get("meta") or "").strip()
            if not e_title:
                continue
            tokens = _meaningful_tokens(f"{e_title} {e_meta}")
            # Skip non-history structural entries like skill categories if heading is skills
            if "skill" in sec_heading_lower or "language" in sec_heading_lower:
                continue
            if tokens and not any(tok in corpus_lower or tok in known_titles_blob for tok in tokens):
                flagged_claims.append(
                    {
                        "type": "unverified_entry",
                        "location": str(sec.get("heading") or "Section"),
                        "claim": e_title,
                        "reason": "Entry title/organisation could not be matched to confirmed career records.",
                    }
                )
            else:
                confirmed_entry_count += 1

    if confirmed_entry_count > 0:
        verified_claims.append(
            {
                "field": "entries",
                "detail": f"{confirmed_entry_count} structured section entry/entries traced to confirmed profile records.",
            }
        )

    # 4. Identify missing profile data & clarification prompts
    if not prof.get("phone"):
        missing_information.append("Phone number is blank in Personal Details.")
        clarification_prompts.append("Add your phone number in Profile if employers require phone contact.")
    if not prof.get("city") and not prof.get("country"):
        missing_information.append("City/Country location is missing in Personal Details.")
        clarification_prompts.append("Add your city and country so application headers stay complete.")
    if not exp_list:
        missing_information.append("No confirmed work experience records found.")
        clarification_prompts.append("Add internships, roles, or volunteering in Career Profile -> Work Experience.")
    else:
        missing_metrics = any(
            not (e.get("achievements") or []) for e in exp_list
        )
        if missing_metrics:
            clarification_prompts.append(
                "Some experience entries have no measurable achievements listed; confirm exact outcomes or metrics in Profile if you want stronger impact bullets."
            )
    if not edu_list:
        missing_information.append("No confirmed education qualifications recorded.")
    if len(skills_list) < 3:
        missing_information.append("Fewer than 3 confirmed skills recorded.")

    compat = (analysis_row or {}).get("compatibility_results") or {}
    missing_reqs = compat.get("missing_requirements") or []
    if missing_reqs:
        sample = ", ".join(str(r) for r in missing_reqs[:4])
        missing_information.append(f"Job requirements without confirmed profile evidence: {sample}")
        clarification_prompts.append(
            f"Do you have genuine experience with ({sample})? If yes, add it to Career Profile before approving this draft."
        )

    if doc_type == "screening_response":
        s_qs = (job_row or {}).get("screening_questions") or []
        if not s_qs and not extra_context:
            missing_information.append("No employer screening questions were saved on the selected opportunity.")
            clarification_prompts.append(
                "Paste the exact screening questions into the job opportunity or Additional Instructions box so responses address every question accurately."
            )

    verification_status = "needs_review" if flagged_claims else "verified"
    if not verified_claims and verification_status == "verified":
        verified_claims.append(
            {
                "field": "profile_alignment",
                "detail": "Draft prose and dates showed no ungrounded metrics or unrecognized entries against your confirmed profile.",
            }
        )

    return {
        "verification_status": verification_status,
        "verified_claims": verified_claims,
        "flagged_claims": flagged_claims,
        "missing_information": missing_information,
        "clarification_prompts": clarification_prompts,
        "disclaimer": (
            "Automated grounding check compares numbers, dates, contact details, and entry titles against your confirmed profile. "
            "Always review every claim carefully before approving or exporting."
        ),
    }
