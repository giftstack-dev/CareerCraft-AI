"""Integration and regression tests for Flask app factory, health endpoints, headers, and auth enforcement."""

from __future__ import annotations

import ast
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
ROOT_DIR = Path(__file__).resolve().parents[2]

try:
    from app import create_app
    from config import Config
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False


class TestHealthConnectivitySignature(unittest.TestCase):
    def test_all_calls_to_run_live_connectivity_checks_use_valid_keyword_args(self) -> None:
        dashboard_path = ROOT_DIR / "backend" / "routes" / "dashboard.py"
        src = dashboard_path.read_text(encoding="utf-8")
        tree = ast.parse(src, filename=str(dashboard_path))

        func_defs = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "run_live_connectivity_checks"
        ]
        self.assertEqual(len(func_defs), 1)
        valid_kw_names = {arg.arg for arg in func_defs[0].args.args} | {
            arg.arg for arg in func_defs[0].args.kwonlyargs
        }

        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "run_live_connectivity_checks"
        ]
        self.assertGreaterEqual(len(calls), 2)
        for call in calls:
            for kw in call.keywords:
                self.assertIn(
                    kw.arg,
                    valid_kw_names,
                    f"Invalid keyword argument '{kw.arg}' passed to run_live_connectivity_checks",
                )
        self.assertIn("run_live_connectivity_checks(cfg, run_gemini_generation=run_gen)", src)
        self.assertNotIn("run_live_connectivity_checks(cfg, run_generation_check=", src)


@unittest.skipUnless(FLASK_AVAILABLE, "Flask dependencies not installed in current Python runtime")
class TestApiSkeleton(unittest.TestCase):
    def setUp(self) -> None:
        cfg = Config(TESTING=True, FLASK_ENV="development", SUPABASE_URL="https://example.supabase.co")
        self.app = create_app(config_override=cfg)
        self.client = self.app.test_client()

    def test_health_endpoint_returns_structured_ok(self) -> None:
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["status"], "ok")
        self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff")

    def test_connectivity_endpoint_reports_live_results_without_secrets(self) -> None:
        mock_live = {
            "overall_status": "degraded",
            "supabase_auth": {"connected": True, "status": "connected"},
            "supabase_jwks": {"connected": True, "status": "connected", "key_count": 1},
            "supabase_database": {"connected": False, "status": "schema_not_initialized", "schema_ready": False},
            "gemini_api": {"connected": True, "status": "connected", "model": "gemini-2.5-flash", "generation_verified": True},
        }
        with patch("routes.dashboard.run_live_connectivity_checks", return_value=mock_live):
            resp = self.client.get("/api/health/connectivity")
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["success"])
            self.assertEqual(body["data"]["status"], "degraded")
            self.assertEqual(body["data"]["connectivity"]["supabase_database"]["status"], "schema_not_initialized")
            self.assertTrue(body["data"]["connectivity"]["gemini_api"]["generation_verified"])

    def test_connectivity_endpoint_full_and_light_modes_without_type_error(self) -> None:
        ok_probe = {"connected": True, "status": "connected"}
        with (
            patch("routes.dashboard._probe_supabase_auth", return_value=ok_probe),
            patch("routes.dashboard._probe_supabase_jwks", return_value={**ok_probe, "key_count": 1}),
            patch("routes.dashboard._probe_supabase_database", return_value={**ok_probe, "schema_ready": True}),
            patch(
                "routes.dashboard._probe_gemini_api",
                side_effect=lambda cfg, run_generation_check=True: {
                    "connected": True,
                    "status": "connected",
                    "model": "gemini-2.5-flash",
                    "generation_verified": run_generation_check,
                },
            ) as gemini_mock,
        ):
            for path in ("/api/health/connectivity", "/api/health/connectivity?mode=full"):
                resp = self.client.get(path)
                self.assertEqual(resp.status_code, 200)
                body = resp.get_json()
                self.assertTrue(body["success"])
                self.assertEqual(body["data"]["status"], "connected")
                self.assertTrue(body["data"]["connectivity"]["gemini_api"]["generation_verified"])
                self.assertTrue(gemini_mock.call_args.kwargs["run_generation_check"])

            resp_light = self.client.get("/api/health/connectivity?mode=light")
            self.assertEqual(resp_light.status_code, 200)
            body_light = resp_light.get_json()
            self.assertTrue(body_light["success"])
            self.assertEqual(body_light["data"]["status"], "connected")
            self.assertFalse(body_light["data"]["connectivity"]["gemini_api"]["generation_verified"])
            self.assertFalse(gemini_mock.call_args.kwargs["run_generation_check"])

    def test_protected_endpoints_reject_unauthenticated_requests(self) -> None:
        protected_routes = [
            ("GET", "/api/dashboard"),
            ("GET", "/api/profile"),
            ("GET", "/api/cv"),
            ("GET", "/api/jobs"),
            ("GET", "/api/documents"),
            ("GET", "/api/applications"),
            ("GET", "/api/interviews"),
            ("GET", "/api/usage"),
            ("GET", "/api/notifications"),
            ("POST", "/api/account/delete"),
        ]
        for method, route in protected_routes:
            resp = self.client.open(route, method=method)
            self.assertEqual(resp.status_code, 401, f"Expected 401 on {method} {route}")
            body = resp.get_json()
            self.assertFalse(body["success"])
            self.assertEqual(body["error"]["code"], "missing_token")


if __name__ == "__main__":
    unittest.main()
