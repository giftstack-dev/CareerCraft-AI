"""Phase 1 Foundation tests for CareerCraft AI backend utilities and configuration."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import Config
from utils.security import sanitize_filename, validate_user_storage_path
from utils.validators import is_safe_http_url, is_valid_email, is_valid_uuid


class TestPhase1Foundation(unittest.TestCase):
    def test_config_ignores_wildcard_cors(self) -> None:
        os.environ["ALLOWED_ORIGINS"] = "*, https://app.careercraft.example"
        cfg = Config()
        self.assertEqual(cfg.ALLOWED_ORIGINS, ["https://app.careercraft.example"])
        del os.environ["ALLOWED_ORIGINS"]

    def test_sanitize_filename_blocks_traversal(self) -> None:
        self.assertEqual(sanitize_filename("../../etc/passwd"), "passwd")
        self.assertEqual(sanitize_filename("My CV (Final).pdf"), "My_CV_Final_.pdf")
        self.assertEqual(sanitize_filename("..."), "document")

    def test_validate_user_storage_path_ownership(self) -> None:
        uid = "11111111-1111-1111-1111-111111111111"
        other_uid = "22222222-2222-2222-2222-222222222222"
        self.assertTrue(validate_user_storage_path(f"{uid}/cv-1/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"{other_uid}/cv-1/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"../{uid}/cv-1/resume.pdf", uid))
        self.assertFalse(validate_user_storage_path(f"/{uid}/cv-1/resume.pdf", uid))

    def test_validators(self) -> None:
        self.assertTrue(is_valid_uuid("11111111-1111-4111-8111-111111111111"))
        self.assertFalse(is_valid_uuid("not-a-uuid"))
        self.assertTrue(is_valid_email("applicant@example.com"))
        self.assertFalse(is_valid_email("invalid-email"))
        self.assertTrue(is_safe_http_url("https://portfolio.example.com"))
        self.assertFalse(is_safe_http_url("javascript:alert(1)"))
        self.assertFalse(is_safe_http_url("data:text/html,<script>"))


if __name__ == "__main__":
    unittest.main()
