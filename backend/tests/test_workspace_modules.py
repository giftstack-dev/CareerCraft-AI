"""Unit tests for CareerCraft AI workspace modules (completion scoring, CV validation, export, routes)."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from services.profile_service import compute_profile_completion
    from services.cv_parser_service import detect_and_validate_cv_file
    from services.document_export_service import render_document_docx, render_document_pdf
    from utils.errors import ValidationError
    MODULES_AVAILABLE = True
except ImportError:
    MODULES_AVAILABLE = False


@unittest.skipUnless(MODULES_AVAILABLE, "Backend dependencies (Flask/ReportLab/PyMuPDF) not installed in current Python runtime")
class TestWorkspaceModules(unittest.TestCase):
    def test_profile_completion_empty_vs_complete(self) -> None:
        empty = compute_profile_completion({}, [], [], [], [], [])
        self.assertEqual(empty["percentage"], 0)
        self.assertEqual(len(empty["suggestions"]), 6)

        full = compute_profile_completion(
            {
                "full_name": "Ada Lovelace",
                "professional_title": "Software Engineer",
                "country": "United Kingdom",
                "professional_summary": "Analytical systems engineer.",
            },
            [{"employer": "Analytical Engines Ltd", "job_title": "Engineer"}],
            [{"institution": "University of London", "qualification": "BSc"}],
            [{"skill_name": "Python"}, {"skill_name": "SQL"}, {"skill_name": "Flask"}],
            [{"project_title": "Engine Compiler"}],
            [],
        )
        self.assertEqual(full["percentage"], 100)
        self.assertEqual(full["suggestions"], [])

    def test_cv_magic_byte_validation(self) -> None:
        self.assertEqual(detect_and_validate_cv_file("cv.pdf", b"%PDF-1.7\n..."), "application/pdf")
        self.assertEqual(
            detect_and_validate_cv_file("cv.docx", b"PK\x03\x04..."),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        with self.assertRaises(ValidationError):
            detect_and_validate_cv_file("cv.exe", b"MZ...")
        with self.assertRaises(ValidationError):
            detect_and_validate_cv_file("fake.pdf", b"NOTAPDF")

    def test_pdf_and_docx_binary_export(self) -> None:
        sample_doc = {
            "document_title": "Tailored CV",
            "template": "modern_minimalist",
            "structured_content": {
                "header": {"full_name": "Ada Lovelace", "email": "ada@example.com", "location": "London, UK"},
                "summary": "Experienced software developer.",
                "sections": [
                    {
                        "heading": "Experience",
                        "entries": [
                            {
                                "title": "Engineer — Acme",
                                "meta": "2023–Present",
                                "bullets": ["Built REST APIs in Python and PostgreSQL."],
                            }
                        ],
                    }
                ],
            },
        }
        pdf_bytes = render_document_pdf(sample_doc)
        docx_bytes = render_document_docx(sample_doc)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))
        self.assertTrue(docx_bytes.startswith(b"PK\x03\x04"))


if __name__ == "__main__":
    unittest.main()
