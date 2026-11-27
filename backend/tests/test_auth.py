"""Integration and security tests for Authentication, /auth/v1/user verification, SDK compatibility, and profile sync."""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
ROOT_DIR = Path(__file__).resolve().parents[2]

try:
    import jwt as pyjwt
    from app import create_app
    from config import Config
    from services.supabase_service import check_supabase_sdk_compatibility

    DEPS_AVAILABLE = True
except ImportError:
    DEPS_AVAILABLE = False


class _FakeHttpResponse:
    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


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

    def test_requirements_and_auth_source_invariants(self) -> None:
        reqs = (ROOT_DIR / "backend" / "requirements.txt").read_text(encoding="utf-8")
        self.assertNotIn("supabase==2.11.0", reqs)
        self.assertIn("supabase>=2.18.0", reqs)

        auth_py = (ROOT_DIR / "backend" / "utils" / "auth.py").read_text(encoding="utf-8")
        self.assertIn("/auth/v1/user", auth_py)
        self.assertIn("SUPABASE_PUBLISHABLE_KEY", auth_py)
        self.assertNotIn("auth.admin.get_user_by_id", auth_py)
        self.assertNotIn('user_metadata.get("email_verified")', auth_py)

        supa_js = (ROOT_DIR / "frontend" / "js" / "supabase-client.js").read_text(encoding="utf-8")
        self.assertNotIn("user.user_metadata", supa_js)
        self.assertIn("email_confirmed_at", supa_js)

        auth_js = (ROOT_DIR / "frontend" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertIn("profile.errorCode === 'email_not_verified'", auth_js)
        self.assertIn("Email verification pending", auth_js)

        guard_js = (ROOT_DIR / "frontend" / "js" / "route-guard.js").read_text(encoding="utf-8")
        self.assertIn("profile.errorCode === 'email_not_verified'", guard_js)


@unittest.skipUnless(DEPS_AVAILABLE, "Flask/PyJWT/Supabase dependencies not installed in current Python runtime")
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
        self.assertEqual(
            body["data"]["providers"],
            {"emailPassword": True, "googleOAuth": True},
        )

    def test_unverified_email_rejected_with_403_and_does_not_init_profile(self) -> None:
        fake_claims = {
            "sub": "11111111-1111-4111-8111-111111111111",
            "email": "user@example.com",
            "role": "authenticated",
            "email_verified": False,
            "user_metadata": {"full_name": "Test User", "email_verified": True},
        }
        with (
            patch("utils.auth.decode_supabase_jwt", return_value=fake_claims),
            patch("routes.auth._ensure_user_profile") as ensure_mock,
        ):
            resp = self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer fake.jwt.token"},
            )
            self.assertEqual(resp.status_code, 403)
            self.assertEqual(resp.get_json()["error"]["code"], "email_not_verified")
            ensure_mock.assert_not_called()

    def test_verified_email_password_user_via_auth_user_endpoint_initializes_profile(self) -> None:
        self.app.config["FORCE_AUTH_USER_ENDPOINT_IN_TESTS"] = True
        fake_claims = {
            "sub": "11111111-1111-4111-8111-111111111111",
            "email": "verified@example.com",
            "role": "authenticated",
            "user_metadata": {"full_name": "Ada Lovelace"},
        }
        auth_user_payload = {
            "id": "11111111-1111-4111-8111-111111111111",
            "email": "verified@example.com",
            "email_confirmed_at": "2026-11-25T09:00:00Z",
            "user_metadata": {"full_name": "Ada Lovelace"},
            "identities": [{"provider": "email"}],
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
            patch("utils.auth.urllib.request.urlopen", return_value=_FakeHttpResponse(auth_user_payload)),
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

    def test_google_oauth_verified_identity_without_user_metadata_initializes_profile(self) -> None:
        self.app.config["FORCE_AUTH_USER_ENDPOINT_IN_TESTS"] = True
        fake_claims = {
            "sub": "22222222-2222-4222-8222-222222222222",
            "email": "oauth-user@gmail.com",
            "role": "authenticated",
            "user_metadata": {"name": "Grace Hopper"},
        }
        auth_user_payload = {
            "id": "22222222-2222-4222-8222-222222222222",
            "email": "oauth-user@gmail.com",
            "email_confirmed_at": None,
            "user_metadata": {"name": "Grace Hopper"},
            "identities": [
                {
                    "provider": "google",
                    "email": "oauth-user@gmail.com",
                    "identity_data": {"email": "oauth-user@gmail.com", "email_verified": True},
                }
            ],
        }
        mock_profile = {
            "id": "22222222-2222-4222-8222-222222222222",
            "full_name": "Grace Hopper",
            "email": "oauth-user@gmail.com",
            "onboarding_status": "completed",
            "onboarding_step": 7,
        }
        with (
            patch("utils.auth.decode_supabase_jwt", return_value=fake_claims),
            patch("utils.auth.urllib.request.urlopen", return_value=_FakeHttpResponse(auth_user_payload)),
            patch("routes.auth._ensure_user_profile", return_value=mock_profile) as ensure_mock,
        ):
            resp = self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer google.jwt.token"},
            )
            self.assertEqual(resp.status_code, 200)
            ensure_mock.assert_called_once_with(
                "22222222-2222-4222-8222-222222222222",
                "oauth-user@gmail.com",
                "Grace Hopper",
            )
            self.assertEqual(resp.get_json()["data"]["profile"]["onboarding_status"], "completed")

    def test_tampered_user_metadata_email_verified_still_rejected_as_unverified(self) -> None:
        self.app.config["FORCE_AUTH_USER_ENDPOINT_IN_TESTS"] = True
        fake_claims = {
            "sub": "33333333-3333-4333-8333-333333333333",
            "email": "attacker@example.com",
            "role": "authenticated",
            "user_metadata": {"email_verified": True},
        }
        auth_user_payload = {
            "id": "33333333-3333-4333-8333-333333333333",
            "email": "attacker@example.com",
            "email_confirmed_at": None,
            "confirmed_at": None,
            "user_metadata": {"email_verified": True},
            "identities": [{"provider": "email"}],
        }
        with (
            patch("utils.auth.decode_supabase_jwt", return_value=fake_claims),
            patch("utils.auth.urllib.request.urlopen", return_value=_FakeHttpResponse(auth_user_payload)),
            patch("routes.auth._ensure_user_profile") as ensure_mock,
        ):
            resp = self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer tampered.jwt.token"},
            )
            self.assertEqual(resp.status_code, 403)
            self.assertEqual(resp.get_json()["error"]["code"], "email_not_verified")
            ensure_mock.assert_not_called()

    def test_auth_user_network_and_key_errors_not_converted_to_email_not_verified(self) -> None:
        self.app.config["FORCE_AUTH_USER_ENDPOINT_IN_TESTS"] = True
        fake_claims = {
            "sub": "44444444-4444-4444-8444-444444444444",
            "email": "ada@example.com",
            "role": "authenticated",
        }
        with patch("utils.auth.decode_supabase_jwt", return_value=fake_claims):
            with patch("utils.auth.urllib.request.urlopen", side_effect=urllib.error.URLError("timed out")):
                resp = self.client.get("/api/auth/me", headers={"Authorization": "Bearer valid.jwt"})
                self.assertEqual(resp.status_code, 503)
                self.assertEqual(resp.get_json()["error"]["code"], "auth_network_error")

            key_err = urllib.error.HTTPError(
                url="https://demo.supabase.co/auth/v1/user",
                code=401,
                msg="Unauthorized",
                hdrs=None,
                fp=io.BytesIO(b'{"message":"Invalid API key"}'),
            )
            with patch("utils.auth.urllib.request.urlopen", side_effect=key_err):
                resp = self.client.get("/api/auth/me", headers={"Authorization": "Bearer valid.jwt"})
                self.assertEqual(resp.status_code, 503)
                self.assertEqual(resp.get_json()["error"]["code"], "supabase_key_error")

            session_err = urllib.error.HTTPError(
                url="https://demo.supabase.co/auth/v1/user",
                code=401,
                msg="Unauthorized",
                hdrs=None,
                fp=io.BytesIO(b'{"error_code":"session_not_found","msg":"Session from session_id claim in JWT does not exist"}'),
            )
            with patch("utils.auth.urllib.request.urlopen", side_effect=session_err):
                resp = self.client.get("/api/auth/me", headers={"Authorization": "Bearer valid.jwt"})
                self.assertEqual(resp.status_code, 401)
                self.assertEqual(resp.get_json()["error"]["code"], "invalid_session")

    def test_sdk_compatibility_detector(self) -> None:
        compat = check_supabase_sdk_compatibility(self.cfg)
        self.assertTrue(compat["uses_modern_publishable"])
        self.assertTrue(compat["uses_modern_secret"])
        self.assertFalse(compat["misconfigured_key_role"])

        swapped_cfg = Config(
            TESTING=True,
            SUPABASE_URL="https://demo.supabase.co",
            SUPABASE_PUBLISHABLE_KEY="sb_secret_wrong_slot",
            SUPABASE_SECRET_KEY="sb_publishable_wrong_slot",
        )
        swapped = check_supabase_sdk_compatibility(swapped_cfg)
        self.assertTrue(swapped["misconfigured_key_role"])
        self.assertFalse(swapped["sdk_compatible"])


if __name__ == "__main__":
    unittest.main()
