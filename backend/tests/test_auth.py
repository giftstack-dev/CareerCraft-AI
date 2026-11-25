"""Integration tests for Phase 2 Authentication, JWKS verification, and config safety."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    import jwt as pyjwt
    from app import create_app
    from config import Config

    DEPS_AVAILABLE = True
except ImportError:
    DEPS_AVAILABLE = False


class TestPhase2AuthConfig(unittest.TestCase):
    def test_config_reads_new_supabase_variables(self) -> None:
        from config import Config as Cfg

        cfg = Cfg(
            SUPABASE_URL="https://demo.supabase.co",
            SUPABASE_PUBLISHABLE_KEY="sb_publishable_demo_key",
            SUPABASE_SECRET_KEY="sb_secret_demo_key",
            SUPABASE_JWKS_URL="https://demo.supabase.co/auth/v1/.well-known/jwks.json",
        )
        self.assertTrue(cfg.supabase_public_configured)
        self.assertTrue(cfg.supabase_configured)
        self.assertEqual(
            cfg.resolved_jwks_url,
            "https://demo.supabase.co/auth/v1/.well-known/jwks.json",
        )


@unittest.skipUnless(DEPS_AVAILABLE, "Flask/PyJWT dependencies not installed in current Python runtime")
class TestPhase2AuthEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = Config(
            TESTING=True,
            FLASK_ENV="development",
            SUPABASE_URL="https://demo.supabase.co",
            SUPABASE_PUBLISHABLE_KEY="sb_publishable_demo",
            SUPABASE_SECRET_KEY="sb_secret_must_never_leak",
            SUPABASE_JWKS_URL="https://demo.supabase.co/auth/v1/.well-known/jwks.json",
            GEMINI_API_KEY="gemini_secret_must_never_leak",
        )
        self.app = create_app(config_override=self.cfg)
        self.client = self.app.test_client()

    def test_public_auth_config_never_exposes_secrets(self) -> None:
        resp = self.client.get("/api/auth/config")
        self.assertEqual(resp.status_code, 200)
        raw = resp.get_data(as_text=True)
        self.assertNotIn("sb_secret_must_never_leak", raw)
        self.assertNotIn("gemini_secret_must_never_leak", raw)
        body = resp.get_json()
        self.assertEqual(body["data"]["supabaseUrl"], "https://demo.supabase.co")
        self.assertEqual(body["data"]["supabasePublishableKey"], "sb_publishable_demo")

    def test_unverified_email_rejected_with_403(self) -> None:
        fake_claims = {
            "sub": "11111111-1111-4111-8111-111111111111",
            "email": "user@example.com",
            "role": "authenticated",
            "email_verified": False,
            "user_metadata": {"full_name": "Test User", "email_verified": False},
        }
        with patch("utils.auth.decode_supabase_jwt", return_value=fake_claims):
            resp = self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer fake.jwt.token"},
            )
            self.assertEqual(resp.status_code, 403)
            self.assertEqual(resp.get_json()["error"]["code"], "email_not_verified")

    def test_verified_user_initializes_profile(self) -> None:
        fake_claims = {
            "sub": "11111111-1111-4111-8111-111111111111",
            "email": "verified@example.com",
            "role": "authenticated",
            "email_confirmed_at": "2026-11-25T09:00:00Z",
            "user_metadata": {"full_name": "Ada Lovelace", "email_verified": True},
        }
        mock_profile = {
            "id": "11111111-1111-4111-8111-111111111111",
            "full_name": "Ada Lovelace",
            "email": "verified@example.com",
            "onboarding_status": "not_started",
            "onboarding_step": 1,
        }
        with (
            patch("utils.auth.decode_supabase_jwt", return_value=fake_claims),
            patch("routes.auth._ensure_user_profile", return_value=mock_profile),
        ):
            resp = self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer valid.jwt.token"},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["success"])
            self.assertEqual(body["data"]["profile"]["onboarding_status"], "not_started")


if __name__ == "__main__":
    unittest.main()
