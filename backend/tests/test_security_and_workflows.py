"""Security, Factual Grounding, Cold-Start, and End-to-End Workflow Audit Tests."""

from __future__ import annotations

import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.grounding_service import verify_document_grounding
from utils.security import sanitize_filename, validate_user_storage_path

ROOT_DIR = Path(__file__).resolve().parents[2]

try:
    from app import create_app
    from config import Config
    from services.document_export_service import (
        TEMPLATE_STYLES,
        _normalize_pdf_text,
        render_document_docx,
        render_document_pdf,
    )

    FLASK_DEPS_AVAILABLE = True
except ImportError:
    FLASK_DEPS_AVAILABLE = False


class TestSecurityPathAndFilenameValidation(unittest.TestCase):
    def test_validate_user_storage_path_enforces_user_prefix_and_blocks_traversal(self) -> None:
        uid = "11111111-1111-4111-8111-111111111111"
        other_uid = "22222222-2222-4222-8222-222222222222"

        self.assertTrue(validate_user_storage_path(f"{uid}/cv-123/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"{other_uid}/cv-123/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"{uid}/../{other_uid}/cv-123/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"/{uid}/cv-123/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"{uid}/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path("", uid))
        self.assertFalse(validate_user_storage_path(f"{uid}/cv-123/resume.pdf", ""))

    def test_sanitize_filename_strips_traversal_and_unsafe_chars(self) -> None:
        self.assertEqual(sanitize_filename("../../etc/passwd"), "passwd")
        self.assertEqual(sanitize_filename("Ada Lovelace CV (2026)!.pdf"), "Ada_Lovelace_CV_2026_.pdf")
        self.assertEqual(sanitize_filename("...///", fallback="doc"), "doc")


class TestFactualGroundingService(unittest.TestCase):
    def setUp(self) -> None:
        self.confirmed_profile = {
            "profile": {
                "full_name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "",
                "city": "",
                "country": "",
                "professional_title": "Backend Engineer",
                "professional_summary": "Python and SQL systems engineer with 3 years experience.",
            },
            "experience": [
                {
                    "employer": "Analytical Engines Ltd",
                    "job_title": "Software Engineer",
                    "start_date": "2022-01-15",
                    "end_date": "2024-12-01",
                    "responsibilities": ["Built Flask APIs and PostgreSQL queries."],
                    "achievements": ["Reduced report latency by 25% across nightly jobs."],
                }
            ],
            "education": [
                {
                    "institution": "University of London",
                    "qualification": "BSc Computer Science",
                    "field_of_study": "Computer Science",
                    "start_date": "2018-09-01",
                    "end_date": "2021-06-30",
                    "achievements": "First Class Honours",
                }
            ],
            "skills": [
                {"skill_name": "Python", "skill_category": "technical"},
                {"skill_name": "PostgreSQL", "skill_category": "technical"},
            ],
            "projects": [],
            "certifications": [],
        }

    def test_flags_ungrounded_metrics_years_contact_and_fake_employers(self) -> None:
        fabricated_content = {
            "header": {
                "full_name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "+1 555 999 8888",
            },
            "summary": "Increased enterprise revenue by 88% in 2016 using Kubernetes clusters.",
            "sections": [
                {
                    "heading": "Work Experience",
                    "entries": [
                        {
                            "title": "Principal Cloud Architect — MegaFakeCorp",
                            "meta": "2016 - 2017",
                            "description": "Managed $4.5M cloud spend across 120 engineers.",
                            "bullets": ["Delivered 3.5x throughput improvements."],
                        }
                    ],
                }
            ],
            "paragraphs": [],
            "closing": "",
        }

        report = verify_document_grounding(
            structured_content=fabricated_content,
            doc_type="cv",
            profile_bundle=self.confirmed_profile,
        )

        self.assertEqual(report["verification_status"], "needs_review")
        flag_types = {item["type"] for item in report["flagged_claims"]}
        self.assertIn("unconfirmed_contact", flag_types)
        self.assertIn("unverified_metric", flag_types)
        self.assertIn("unverified_year", flag_types)
        self.assertIn("unverified_entry", flag_types)
        self.assertTrue(len(report["missing_information"]) >= 3)
        self.assertTrue(len(report["clarification_prompts"]) >= 1)

    def test_passes_strictly_grounded_draft_and_surfaces_clarifications(self) -> None:
        grounded_content = {
            "header": {
                "full_name": "Ada Lovelace",
                "email": "ada@example.com",
            },
            "summary": "Backend Engineer with 3 years experience in Python and PostgreSQL.",
            "sections": [
                {
                    "heading": "Work Experience",
                    "entries": [
                        {
                            "title": "Software Engineer — Analytical Engines Ltd",
                            "meta": "2022 - 2024",
                            "description": "",
                            "bullets": ["Reduced report latency by 25% across nightly jobs."],
                        }
                    ],
                },
                {
                    "heading": "Education",
                    "entries": [
                        {
                            "title": "BSc Computer Science — University of London",
                            "meta": "2018 - 2021",
                            "description": "First Class Honours",
                            "bullets": [],
                        }
                    ],
                },
            ],
            "paragraphs": [],
            "closing": "",
        }

        report = verify_document_grounding(
            structured_content=grounded_content,
            doc_type="screening_response",
            profile_bundle=self.confirmed_profile,
            analysis_row={"compatibility_results": {"missing_requirements": ["Docker", "Redis"]}},
        )

        self.assertEqual(report["verification_status"], "verified")
        self.assertEqual(report["flagged_claims"], [])
        self.assertTrue(any("Docker" in item for item in report["missing_information"]))
        self.assertTrue(any("screening questions" in item.lower() for item in report["missing_information"]))


class TestStaticRegressionInvariants(unittest.TestCase):
    def test_no_postgrest_update_select_chaining_or_user_route_secret_client(self) -> None:
        backend_dir = ROOT_DIR / "backend"
        for py_file in backend_dir.rglob("*.py"):
            if "tests" in py_file.parts:
                continue
            src = py_file.read_text(encoding="utf-8")
            self.assertNotRegex(
                src,
                r"\.(insert|update|upsert|delete)\([^)]*\)\.select\(",
                f"Found invalid postgrest-py chained .select() after mutation in {py_file}",
            )

        user_route_files = [
            "profile.py",
            "jobs.py",
            "documents.py",
            "applications.py",
            "interviews.py",
            "cv.py",
            "usage.py",
        ]
        for fname in user_route_files:
            content = (backend_dir / "routes" / fname).read_text(encoding="utf-8")
            self.assertNotIn(
                "get_secret_client",
                content,
                f"User route {fname} must use get_user_client(), not get_secret_client()",
            )

    def test_no_four_document_truncation_and_mutating_methods_not_retried(self) -> None:
        docs_py = (ROOT_DIR / "backend" / "routes" / "documents.py").read_text(encoding="utf-8")
        self.assertNotIn("doc_types[:4]", docs_py)

        studio_js = (ROOT_DIR / "frontend" / "js" / "application-studio.js").read_text(encoding="utf-8")
        self.assertNotIn(".slice(0, 4)", studio_js)

        api_js = (ROOT_DIR / "frontend" / "js" / "api.js").read_text(encoding="utf-8")
        self.assertIn("isIdempotentMethod", api_js)
        self.assertIn("!idempotent", api_js)
        self.assertIn("payload.success !== true", api_js)

        config_js = (ROOT_DIR / "frontend" / "js" / "config.js").read_text(encoding="utf-8")
        self.assertIn("30000", config_js)


@unittest.skipUnless(FLASK_DEPS_AVAILABLE, "Flask/ReportLab/python-docx not installed in current Python runtime")
class TestFlaskRoutesAndExportsWithMocks(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = Config(
            TESTING=True,
            FLASK_ENV="development",
            SUPABASE_URL="https://demo.supabase.co",
            SUPABASE_PUBLISHABLE_KEY="sb_publishable_demo",
            SUPABASE_SECRET_KEY="sb_secret_demo",
            SUPABASE_JWKS_URL="https://demo.supabase.co/auth/v1/.well-known/jwks.json",
            GEMINI_API_KEY="gemini_demo_key",
            AI_REQUEST_TIMEOUT=30,
        )
        self.app = create_app(config_override=self.cfg)
        self.client = self.app.test_client()
        self.verified_claims = {
            "sub": "11111111-1111-4111-8111-111111111111",
            "email": "ada@example.com",
            "role": "authenticated",
            "email_confirmed_at": "2026-11-25T09:00:00Z",
            "user_metadata": {"full_name": "Ada Lovelace", "email_verified": True},
        }

    def test_connectivity_endpoint_never_returns_500_when_probes_raise(self) -> None:
        with (
            patch("routes.dashboard._probe_supabase_auth", side_effect=RuntimeError("boom-auth")),
            patch("routes.dashboard._probe_supabase_jwks", side_effect=RuntimeError("boom-jwks")),
            patch("routes.dashboard._probe_supabase_database", side_effect=RuntimeError("boom-db")),
            patch("routes.dashboard._probe_gemini_api", side_effect=RuntimeError("boom-gemini")),
        ):
            resp = self.client.get("/api/health/connectivity")
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["success"])
            self.assertEqual(body["data"]["status"], "degraded")

    def test_document_export_across_all_templates_and_winansi_punctuation(self) -> None:
        self.assertEqual(_normalize_pdf_text("Hello — “World”…"), 'Hello  -  "World"...')
        sample_doc = {
            "document_title": "Principal Engineer — Portfolio & CV",
            "structured_content": {
                "header": {
                    "full_name": "Ada Lovelace",
                    "headline": "Backend Systems Engineer — London",
                    "email": "ada@example.com",
                    "location": "London, UK",
                },
                "summary": "Experienced software developer.\nSecond summary line preserved.",
                "sections": [
                    {
                        "heading": "Work Experience",
                        "entries": [
                            {
                                "title": f"Role #{idx} — Analytical Engines",
                                "meta": "2020–2024",
                                "description": "Line one\nLine two",
                                "bullets": [f"Delivered reliable API endpoint #{idx} — with zero downtime."],
                            }
                            for idx in range(1, 18)
                        ],
                    }
                ],
                "paragraphs": ["Paragraph 1 — formal tone.\nWith manual line break."],
                "closing": "Sincerely,\nAda Lovelace",
            },
        }
        for tpl in TEMPLATE_STYLES:
            doc_copy = {**sample_doc, "template": tpl}
            pdf_bytes = render_document_pdf(doc_copy)
            docx_bytes = render_document_docx(doc_copy)
            self.assertTrue(pdf_bytes.startswith(b"%PDF-"), f"Invalid PDF for {tpl}")
            self.assertTrue(docx_bytes.startswith(b"PK\x03\x04"), f"Invalid DOCX for {tpl}")

    def test_auth_ensure_profile_and_onboarding_status_with_user_client(self) -> None:
        mock_user_db = MagicMock()
        profile_row = {
            "id": "11111111-1111-4111-8111-111111111111",
            "full_name": "Ada Lovelace",
            "email": "ada@example.com",
            "onboarding_status": "not_started",
            "onboarding_step": 1,
        }
        exec_select = MagicMock(data=[profile_row])
        exec_update = MagicMock(data=[{**profile_row, "onboarding_status": "in_progress", "onboarding_step": 3}])

        table_mock = mock_user_db.table.return_value
        table_mock.select.return_value.eq.return_value.limit.return_value.execute.return_value = exec_select
        table_mock.update.return_value.eq.return_value.execute.return_value = exec_update

        with (
            patch("utils.auth.decode_supabase_jwt", return_value=self.verified_claims),
            patch("routes.auth.get_user_client", return_value=mock_user_db),
        ):
            resp = self.client.post(
                "/api/auth/onboarding-status",
                json={"onboarding_status": "in_progress", "onboarding_step": 3},
                headers={"Authorization": "Bearer valid.jwt.token"},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertEqual(body["data"]["profile"]["onboarding_step"], 3)


if __name__ == "__main__":
    unittest.main()
