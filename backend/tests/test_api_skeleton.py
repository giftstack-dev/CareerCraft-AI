"""Integration tests for Flask app factory, health endpoint, headers, and auth enforcement."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from app import create_app
    from config import Config
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False


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
        ]
        for method, route in protected_routes:
            resp = self.client.open(route, method=method)
            self.assertEqual(resp.status_code, 401, f"Expected 401 on {method} {route}")
            body = resp.get_json()
            self.assertFalse(body["success"])
            self.assertEqual(body["error"]["code"], "missing_token")


if __name__ == "__main__":
    unittest.main()
