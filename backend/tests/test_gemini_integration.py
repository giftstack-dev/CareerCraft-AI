"""Regression and integration tests for Gemini SDK upgrade, diagnostics, retry logic, and AI workflows."""

from __future__ import annotations

import json
import os
import re
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
ROOT_DIR = Path(__file__).resolve().parents[2]

from services.gemini_diagnostics import (  # noqa: E402
    MalformedAIResponseError,
    classify_gemini_exception,
    compute_backoff_delay,
    extract_finish_reason,
    parse_structured_json,
    sanitize_diagnostic_message,
)

try:
    from app import create_app
    from config import Config
    import utils.auth as auth_utils

    FULL_STACK_AVAILABLE = True
except ImportError:
    FULL_STACK_AVAILABLE = False


class _FakeApiError(Exception):
    def __init__(self, message: str, *, code: int | None = None, status: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class _SyntheticSchema:
    """Minimal Pydantic-like schema contract matching model_validate/model_dump."""

    def __init__(self, *, ok: bool, label: str, items: list[str] | None = None) -> None:
        self.ok = ok
        self.label = label
        self.items = items or []

    @classmethod
    def model_validate(cls, data: dict) -> "_SyntheticSchema":
        if not isinstance(data, dict) or "ok" not in data or not isinstance(data.get("ok"), bool):
            raise ValueError("Missing boolean 'ok'")
        if not isinstance(data.get("label"), str):
            raise ValueError("Missing string 'label'")
        return cls(ok=data["ok"], label=data["label"], items=list(data.get("items") or []))

    def model_dump(self) -> dict:
        return {"ok": self.ok, "label": self.label, "items": self.items}


def _load_gemini_service_module():
    """Import services.gemini_service directly or with minimal stdlib stubs when SDK/Flask aren't installed."""
    try:
        import services.gemini_service as gs
        import utils.errors as err_mod

        return gs, err_mod, {}
    except ImportError:
        saved: dict[str, types.ModuleType | None] = {}
        stub_names = ("flask", "google", "google.genai", "google.genai.types", "services.gemini_service", "utils.errors")
        for name in stub_names:
            saved[name] = sys.modules.get(name)

        flask_stub = types.ModuleType("flask")
        flask_stub.current_app = types.SimpleNamespace(config={})
        flask_stub.jsonify = lambda payload: payload

        class _StubHttpOptions:
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class _StubGenerateContentConfig:
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class _StubGenAIClient:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                self.models = MagicMock()

        types_stub = types.ModuleType("google.genai.types")
        types_stub.HttpOptions = _StubHttpOptions
        types_stub.GenerateContentConfig = _StubGenerateContentConfig

        genai_stub = types.ModuleType("google.genai")
        genai_stub.Client = _StubGenAIClient
        genai_stub.types = types_stub

        google_stub = types.ModuleType("google")
        google_stub.genai = genai_stub

        sys.modules["flask"] = flask_stub
        sys.modules["google"] = google_stub
        sys.modules["google.genai"] = genai_stub
        sys.modules["google.genai.types"] = types_stub
        sys.modules.pop("services.gemini_service", None)
        sys.modules.pop("utils.errors", None)

        import utils.errors as err_mod
        import services.gemini_service as gs

        return gs, err_mod, saved


def _restore_stubbed_modules(saved: dict[str, types.ModuleType | None]) -> None:
    if not saved:
        return
    for name, mod in saved.items():
        if mod is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = mod


class TestGeminiRequirementsAndStaticInvariants(unittest.TestCase):
    def test_requirements_upgrades_google_genai_and_preserves_supabase_pyjwt_pydantic(self) -> None:
        req_text = (ROOT_DIR / "backend" / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("PyJWT[crypto]==2.10.1", req_text)
        self.assertIn("supabase>=2.18.0,<3.0.0", req_text)
        self.assertIn("pydantic>=2.11.7,<3.0.0", req_text)
        self.assertNotIn("google-genai==1.5.0", req_text)
        match = re.search(r"^google-genai==(\d+)\.(\d+)\.(\d+)$", req_text, flags=re.MULTILINE)
        self.assertIsNotNone(match, "google-genai must be pinned to a modern 3.x release")
        self.assertGreaterEqual(int(match.group(1)), 3)

    def test_gemini_service_connectivity_tokens_and_no_paid_model_fallback(self) -> None:
        svc_src = (ROOT_DIR / "backend" / "services" / "gemini_service.py").read_text(encoding="utf-8")
        self.assertNotIn("max_output_tokens=4", svc_src)
        self.assertIn("CONNECTIVITY_MAX_OUTPUT_TOKENS = 256", svc_src)
        self.assertNotIn("temperature=0.0", svc_src)
        self.assertNotIn("temperature=0.2", svc_src)
        for paid_model in ("gemini-4-carbon", "gemini-4-neon", "gemini-4-argon"):
            self.assertNotIn(paid_model, svc_src)

        dash_src = (ROOT_DIR / "backend" / "routes" / "dashboard.py").read_text(encoding="utf-8")
        self.assertIn("include_diagnostics=False", dash_src)

    def test_cv_upload_frontend_supports_retry_without_reupload(self) -> None:
        js_src = (ROOT_DIR / "frontend" / "js" / "cv-upload.js").read_text(encoding="utf-8")
        self.assertIn("Retry AI Extraction", js_src)
        self.assertIn("selectedCv.parsing_status === 'failed'", js_src)
        self.assertIn("without re-uploading", js_src)


class TestGeminiDiagnosticsPurePython(unittest.TestCase):
    def test_sanitize_diagnostic_message_redacts_keys_and_tokens(self) -> None:
        secret = "AIzaSyExampleSecretValue1234567890"
        raw = f"Request to https://generativelanguage.googleapis.com/v1?key={secret} failed Bearer tok_abc.xyz"
        cleaned = sanitize_diagnostic_message(raw, api_key=secret)
        self.assertNotIn(secret, cleaned)
        self.assertNotIn("tok_abc.xyz", cleaned)
        self.assertIn("[REDACTED]", cleaned)

    def test_classify_all_required_error_categories_and_retryability(self) -> None:
        # 1. Invalid API key (400 API_KEY_INVALID and 403 PERMISSION_DENIED)
        invalid_400 = _FakeApiError("400 INVALID_ARGUMENT: API key not valid.", code=400, status="INVALID_ARGUMENT")
        res_400 = classify_gemini_exception(invalid_400)
        self.assertEqual(res_400["error_category"], "invalid_api_key")
        self.assertEqual(res_400["connectivity_status"], "auth_error")
        self.assertFalse(res_400["retryable"])

        invalid_403 = _FakeApiError("PERMISSION_DENIED: caller does not have permission", code=403, status="PERMISSION_DENIED")
        res_403 = classify_gemini_exception(invalid_403)
        self.assertEqual(res_403["error_category"], "invalid_api_key")
        self.assertFalse(res_403["retryable"])

        # 2. Unsupported model (404)
        missing_model = _FakeApiError("models/gemini-bad is not found for API version v1", code=404, status="NOT_FOUND")
        res_404 = classify_gemini_exception(missing_model)
        self.assertEqual(res_404["error_category"], "unsupported_model")
        self.assertEqual(res_404["connectivity_status"], "model_unavailable")
        self.assertFalse(res_404["retryable"])

        # 3. Incompatible request parameters (400 INVALID_ARGUMENT)
        bad_param = _FakeApiError("Unknown name 'thinkingBudget' at generation_config", code=400, status="INVALID_ARGUMENT")
        res_param = classify_gemini_exception(bad_param)
        self.assertEqual(res_param["error_category"], "invalid_parameters")
        self.assertEqual(res_param["connectivity_status"], "invalid_request")
        self.assertFalse(res_param["retryable"])

        # 4. Hard quota exhausted vs transient rate limit
        hard_quota = _FakeApiError("You exceeded your current quota, please check your plan and billing details.", code=429, status="RESOURCE_EXHAUSTED")
        res_quota = classify_gemini_exception(hard_quota)
        self.assertEqual(res_quota["error_category"], "quota_exhausted")
        self.assertEqual(res_quota["app_error_kind"], "rate_limit")
        self.assertFalse(res_quota["retryable"])

        rpm_limit = _FakeApiError("Too many requests per minute; retry shortly.", code=429, status="RESOURCE_EXHAUSTED")
        res_rpm = classify_gemini_exception(rpm_limit)
        self.assertEqual(res_rpm["error_category"], "rate_limited")
        self.assertEqual(res_rpm["app_error_kind"], "rate_limit")
        self.assertTrue(res_rpm["retryable"])

        # 5. Upstream server overload (503)
        ServerError = type("ServerError", (_FakeApiError,), {})
        overload = ServerError("503 UNAVAILABLE: The model is overloaded.", code=503, status="UNAVAILABLE")
        res_503 = classify_gemini_exception(overload)
        self.assertEqual(res_503["error_category"], "service_overload")
        self.assertEqual(res_503["http_status"], 503)
        self.assertTrue(res_503["retryable"])

        # 6. Network / timeout failure
        net_err = TimeoutError("timed out waiting for upstream socket")
        res_net = classify_gemini_exception(net_err)
        self.assertEqual(res_net["error_category"], "network_error")
        self.assertTrue(res_net["retryable"])

        # 7. Malformed response
        malformed = MalformedAIResponseError("Invalid JSON", reason_code="invalid_json")
        res_mal = classify_gemini_exception(malformed)
        self.assertEqual(res_mal["error_category"], "malformed_response")
        self.assertFalse(res_mal["retryable"])

    def test_backoff_is_bounded_and_uses_jitter(self) -> None:
        delays = [compute_backoff_delay(i, base_delay=0.75, max_delay=4.0) for i in range(6)]
        for delay in delays:
            self.assertGreater(delay, 0.0)
            self.assertLessEqual(delay, 4.0)
        self.assertEqual(compute_backoff_delay(0, base_delay=1.0, max_delay=5.0, rng=lambda a, b: a), 0.5)
        self.assertEqual(compute_backoff_delay(0, base_delay=1.0, max_delay=5.0, rng=lambda a, b: b), 1.0)

    def test_parse_structured_json_and_finish_reasons(self) -> None:
        resp = types.SimpleNamespace(candidates=[types.SimpleNamespace(finish_reason="MAX_TOKENS")])
        self.assertEqual(extract_finish_reason(resp), "MAX_TOKENS")

        self.assertEqual(parse_structured_json('```json\n{"ok": true}\n```'), {"ok": True})

        with self.assertRaises(MalformedAIResponseError) as ctx_max:
            parse_structured_json("", finish_reason="MAX_TOKENS")
        self.assertEqual(ctx_max.exception.reason_code, "truncated_max_tokens")

        with self.assertRaises(MalformedAIResponseError) as ctx_bad:
            parse_structured_json("{not-json")
        self.assertEqual(ctx_bad.exception.reason_code, "invalid_json")

        with self.assertRaises(MalformedAIResponseError) as ctx_list:
            parse_structured_json('["not", "an", "object"]')
        self.assertEqual(ctx_list.exception.reason_code, "unexpected_json_type")


class TestGeminiServiceWithStubbedSDK(unittest.TestCase):
    def setUp(self) -> None:
        self.gs_mod, self.err_mod, self._saved_modules = _load_gemini_service_module()
        self.service = self.gs_mod.GeminiService(api_key="AIzaSyDummyTestKey12345", model="gemini-3.8-flash")
        self.mock_models = MagicMock()
        self.service._client = types.SimpleNamespace(models=self.mock_models)

    def tearDown(self) -> None:
        _restore_stubbed_modules(self._saved_modules)

    def test_connectivity_success_uses_at_least_256_tokens_and_minimal_config(self) -> None:
        self.mock_models.get.return_value = types.SimpleNamespace(name="models/gemini-3.8-flash")
        self.mock_models.generate_content.return_value = types.SimpleNamespace(
            text="CONNECTION_OK",
            candidates=[types.SimpleNamespace(finish_reason="STOP")],
        )

        result = self.service.verify_connectivity(run_generation_check=True)
        self.assertTrue(result["connected"])
        self.assertEqual(result["status"], "connected")
        self.assertTrue(result["model_available"])
        self.assertTrue(result["generation_verified"])
        self.assertTrue(result["model_lookup"]["ok"])
        self.assertTrue(result["generation_check"]["ok"])

        call_kwargs = self.mock_models.generate_content.call_args.kwargs
        self.assertEqual(call_kwargs["model"], "gemini-3.8-flash")
        self.assertEqual(call_kwargs["contents"], "Reply with CONNECTION_OK.")
        self.assertGreaterEqual(call_kwargs["config"].max_output_tokens, 256)
        self.assertIsNone(getattr(call_kwargs["config"], "temperature", None))

    def test_connectivity_separates_model_lookup_failure_from_generation(self) -> None:
        self.mock_models.get.side_effect = _FakeApiError(
            "Model gemini-3.8-flash not found for API key AIzaSyDummyTestKey12345",
            code=404,
            status="NOT_FOUND",
        )

        public_res = self.service.verify_connectivity(run_generation_check=True, include_diagnostics=False)
        self.assertFalse(public_res["connected"])
        self.assertFalse(public_res["model_available"])
        self.assertFalse(public_res["generation_verified"])
        self.assertEqual(public_res["error_category"], "unsupported_model")
        self.assertEqual(public_res["http_status"], 404)
        self.assertFalse(public_res["retryable"])
        self.assertEqual(public_res["generation_check"]["status"], "skipped_model_lookup_failed")
        self.assertNotIn("diagnostic_message", public_res)
        self.mock_models.generate_content.assert_not_called()

        internal_res = self.service.verify_connectivity(run_generation_check=True, include_diagnostics=True)
        self.assertIn("diagnostic_message", internal_res)
        self.assertNotIn("AIzaSyDummyTestKey12345", internal_res["diagnostic_message"])

    def test_connectivity_model_lookup_ok_but_generation_fails(self) -> None:
        self.mock_models.get.return_value = types.SimpleNamespace(name="models/gemini-3.8-flash")
        ServerError = type("ServerError", (_FakeApiError,), {})
        self.mock_models.generate_content.side_effect = ServerError(
            "503 UNAVAILABLE: Temporary capacity issue", code=503, status="UNAVAILABLE"
        )

        res = self.service.verify_connectivity(run_generation_check=True, include_diagnostics=False)
        self.assertFalse(res["connected"])
        self.assertTrue(res["model_available"])
        self.assertTrue(res["model_lookup"]["ok"])
        self.assertFalse(res["generation_verified"])
        self.assertFalse(res["generation_check"]["ok"])
        self.assertEqual(res["error_category"], "service_overload")
        self.assertEqual(res["http_status"], 503)
        self.assertTrue(res["retryable"])

    def test_generate_structured_synthetic_schema_and_transient_backoff_recovery(self) -> None:
        ServerError = type("ServerError", (_FakeApiError,), {})
        self.mock_models.generate_content.side_effect = [
            ServerError("503 UNAVAILABLE", code=503, status="UNAVAILABLE"),
            types.SimpleNamespace(
                text=json.dumps({"ok": True, "label": "verified", "items": ["a", "b"]}),
                usage_metadata=types.SimpleNamespace(prompt_token_count=10, candidates_token_count=12, total_token_count=22),
                candidates=[types.SimpleNamespace(finish_reason="STOP")],
            ),
        ]

        with patch.object(self.gs_mod.time, "sleep") as sleep_mock:
            out = self.service.generate_structured(
                task_instruction="Return synthetic status.",
                user_payload="Check schema.",
                response_schema=_SyntheticSchema,
                max_retries=2,
            )

        self.assertEqual(self.mock_models.generate_content.call_count, 2)
        sleep_mock.assert_called_once()
        self.assertEqual(out["parsed"], {"ok": True, "label": "verified", "items": ["a", "b"]})
        self.assertEqual(json.loads(out["text"])["label"], "verified")

    def test_generate_structured_never_retries_non_transient_errors(self) -> None:
        non_transient_cases = [
            (_FakeApiError("400 INVALID_ARGUMENT: unknown param", code=400, status="INVALID_ARGUMENT"), self.err_mod.ServiceUnavailableError, "ai_invalid_parameters"),
            (_FakeApiError("403 PERMISSION_DENIED", code=403, status="PERMISSION_DENIED"), self.err_mod.ServiceUnavailableError, "ai_auth_error"),
            (_FakeApiError("404 NOT_FOUND", code=404, status="NOT_FOUND"), self.err_mod.ServiceUnavailableError, "ai_model_unavailable"),
            (_FakeApiError("You exceeded your current quota and billing limit.", code=429, status="RESOURCE_EXHAUSTED"), self.err_mod.RateLimitError, "ai_quota_exhausted"),
        ]
        for exc, expected_err_cls, expected_code in non_transient_cases:
            self.mock_models.generate_content.reset_mock()
            self.mock_models.generate_content.side_effect = exc
            with patch.object(self.gs_mod.time, "sleep") as sleep_mock:
                with self.assertRaises(expected_err_cls) as err_ctx:
                    self.service.generate_structured(
                        task_instruction="Test",
                        user_payload="Test",
                        response_schema=_SyntheticSchema,
                        max_retries=2,
                    )
            self.assertEqual(err_ctx.exception.error_code, expected_code)
            self.assertEqual(self.mock_models.generate_content.call_count, 1)
            sleep_mock.assert_not_called()

    def test_generate_structured_malformed_or_schema_invalid_response_raises_clean_error(self) -> None:
        for bad_text in ("not-json-at-all", "", '{"ok": "not-a-bool", "label": 123}'):
            self.mock_models.generate_content.reset_mock()
            self.mock_models.generate_content.return_value = types.SimpleNamespace(
                text=bad_text,
                candidates=[types.SimpleNamespace(finish_reason="STOP")],
            )
            with patch.object(self.gs_mod.time, "sleep") as sleep_mock:
                with self.assertRaises(self.err_mod.ServiceUnavailableError) as err_ctx:
                    self.service.generate_structured(
                        task_instruction="Test",
                        user_payload="Test",
                        response_schema=_SyntheticSchema,
                        max_retries=2,
                    )
            self.assertEqual(err_ctx.exception.error_code, "ai_malformed_response")
            self.assertEqual(self.mock_models.generate_content.call_count, 1)
            sleep_mock.assert_not_called()


class _FakeTableQuery:
    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows or []
        self._op = "select"
        self._payload = None

    def select(self, *_args, **_kwargs):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", "33333333-3333-4333-8333-333333333333")
            return types.SimpleNamespace(data=[row])
        if self._op == "update":
            merged = {**(self._rows[0] if self._rows else {}), **(self._payload or {})}
            return types.SimpleNamespace(data=[merged])
        return types.SimpleNamespace(data=self._rows)


class _FakeStorageBucket:
    def __init__(self, file_bytes: bytes) -> None:
        self._bytes = file_bytes

    def download(self, _path: str) -> bytes:
        return self._bytes


class _FakeUserClient:
    def __init__(self, tables: dict[str, list[dict]], file_bytes: bytes = b"") -> None:
        self._tables = tables
        self._bucket = _FakeStorageBucket(file_bytes)
        self.storage = types.SimpleNamespace(from_=lambda _bucket_name: self._bucket)

    def table(self, name: str) -> _FakeTableQuery:
        return _FakeTableQuery(self._tables.get(name, []))


@unittest.skipUnless(FULL_STACK_AVAILABLE, "Full Flask stack not installed in current Python runtime")
class TestGeminiRoutesEndToEndWithMocks(unittest.TestCase):
    def setUp(self) -> None:
        self.uid = "11111111-1111-4111-8111-111111111111"
        self.cv_id = "22222222-2222-4222-8222-222222222222"
        self.job_id = "44444444-4444-4444-8444-444444444444"
        cfg = Config(
            TESTING=True,
            FLASK_ENV="development",
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_PUBLISHABLE_KEY="sb_publishable_test",
            SUPABASE_SECRET_KEY="sb_secret_test",
            GEMINI_API_KEY="gemini_test_key",
            GEMINI_MODEL="gemini-3.8-flash",
        )
        self.app = create_app(config_override=cfg)
        self.client = self.app.test_client()
        self.auth_headers = {"Authorization": "Bearer valid.test.token"}

    def _auth_patches(self, fake_client: _FakeUserClient):
        user_ctx = auth_utils.AuthenticatedUser(
            user_id=self.uid,
            email="synthetic@example.com",
            email_verified=True,
            access_token="valid.test.token",
        )
        return (
            patch("utils.auth.decode_and_verify_jwt", return_value={"sub": self.uid, "email": "synthetic@example.com"}),
            patch("utils.auth.fetch_authenticated_supabase_user", return_value={"id": self.uid, "email": "synthetic@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z"}),
            patch("utils.auth._ensure_user_row_with_user_client", return_value=None),
            patch("routes.cv.get_user_client", return_value=fake_client),
            patch("routes.jobs.get_user_client", return_value=fake_client),
            patch("routes.documents.get_user_client", return_value=fake_client),
            patch("routes.interviews.get_user_client", return_value=fake_client),
            patch("routes.cv.enforce_daily_ai_quota", return_value=None),
            patch("routes.jobs.enforce_daily_ai_quota", return_value=None),
            patch("routes.documents.enforce_daily_ai_quota", return_value=None),
            patch("routes.interviews.enforce_daily_ai_quota", return_value=None),
            patch("routes.cv.record_usage", return_value=None),
            patch("routes.jobs.record_usage", return_value=None),
            patch("routes.documents.record_usage", return_value=None),
            patch("routes.interviews.record_usage", return_value=None),
            patch("routes.jobs.record_notification", return_value=None),
            patch("routes.documents.record_notification", return_value=None),
            patch("routes.interviews.record_notification", return_value=None),
        )

    def test_cv_parse_failure_and_retry_without_reupload(self) -> None:
        from utils.errors import ServiceUnavailableError

        cv_row = {
            "id": self.cv_id,
            "user_id": self.uid,
            "original_filename": "synthetic_cv.pdf",
            "storage_path": f"{self.uid}/{self.cv_id}/synthetic_cv.pdf",
            "mime_type": "application/pdf",
            "parsing_status": "failed",
            "extracted_data": {"readable": True},
        }
        fake_client = _FakeUserClient({"uploaded_cvs": [cv_row]}, file_bytes=b"%PDF-1.4\n...")
        fake_extract = {"readable": True, "status": "uploaded", "text": "Synthetic Software Engineer Experience at Acme", "page_count": 1, "reason": ""}

        with (
            patch("utils.auth.decode_and_verify_jwt", return_value={"sub": self.uid, "email": "synthetic@example.com"}),
            patch("utils.auth.fetch_authenticated_supabase_user", return_value={"id": self.uid, "email": "synthetic@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z"}),
            patch("routes.cv.get_user_client", return_value=fake_client),
            patch("routes.cv.enforce_daily_ai_quota", return_value=None),
            patch("routes.cv.record_usage", return_value=None),
            patch("routes.cv.extract_text_from_cv", return_value=fake_extract),
            patch("routes.cv.parse_cv_text_with_gemini", side_effect=ServiceUnavailableError("Overloaded", error_code="ai_service_overloaded")),
        ):
            fail_resp = self.client.post("/api/cv/parse", json={"cv_id": self.cv_id}, headers=self.auth_headers)
            self.assertEqual(fail_resp.status_code, 503)
            self.assertEqual(fail_resp.get_json()["error"]["code"], "ai_service_overloaded")

        parsed_payload = {"personal_details": {"full_name": "Synthetic Applicant"}, "skills": []}
        with (
            patch("utils.auth.decode_and_verify_jwt", return_value={"sub": self.uid, "email": "synthetic@example.com"}),
            patch("utils.auth.fetch_authenticated_supabase_user", return_value={"id": self.uid, "email": "synthetic@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z"}),
            patch("routes.cv.get_user_client", return_value=fake_client),
            patch("routes.cv.enforce_daily_ai_quota", return_value=None),
            patch("routes.cv.record_usage", return_value=None),
            patch("routes.cv.extract_text_from_cv", return_value=fake_extract),
            patch("routes.cv.parse_cv_text_with_gemini", return_value=(parsed_payload, None)),
        ):
            ok_resp = self.client.post("/api/cv/parse", json={"cv_id": self.cv_id}, headers=self.auth_headers)
            self.assertEqual(ok_resp.status_code, 200)
            body = ok_resp.get_json()
            self.assertTrue(body["success"])
            self.assertEqual(body["data"]["parsed"]["personal_details"]["full_name"], "Synthetic Applicant")

    def test_jobs_documents_and_interviews_ai_workflows_with_mocks(self) -> None:
        job_row = {
            "id": self.job_id,
            "user_id": self.uid,
            "company_name": "Acme Corp",
            "job_title": "Backend Engineer",
            "original_job_description": "Build reliable Python Flask APIs and PostgreSQL services for web applications.",
            "screening_questions": [],
        }
        profile_bundle = {
            "profile": {"full_name": "Synthetic Applicant", "email": "synthetic@example.com", "professional_title": "Backend Engineer"},
            "experience": [{"employer": "Beta Labs", "job_title": "Python Developer", "start_date": "2023-01-01", "is_current": True, "responsibilities": ["Built Flask APIs"], "achievements": []}],
            "education": [],
            "skills": [{"skill_name": "Python", "skill_category": "technical"}],
            "projects": [],
            "certifications": [],
        }
        fake_client = _FakeUserClient(
            {
                "job_opportunities": [job_row],
                "job_analyses": [{"id": "55555555-5555-4555-8555-555555555555", "job_opportunity_id": self.job_id, "structured_analysis": {"job_title": "Backend Engineer", "required_skills": ["Python"]}}],
                "generated_documents": [],
                "document_versions": [],
                "interview_sessions": [],
            }
        )

        mock_gemini = MagicMock()
        mock_gemini.generate_structured.side_effect = [
            {"text": json.dumps({"job_title": "Backend Engineer", "company_name": "Acme Corp", "required_skills": ["Python"]}), "usage": None},
            {"text": json.dumps({"alignment_score": 85, "score_explanation": "Strong Python/Flask overlap.", "matching_skills": ["Python"]}), "usage": None},
            {"text": json.dumps({"document_title": "Cover Letter — Backend Engineer", "header": {"full_name": "Synthetic Applicant"}, "paragraphs": ["Applying for Backend Engineer at Acme Corp with Python Flask experience at Beta Labs."], "grounding_notes": ["Beta Labs experience"]}), "usage": None},
            {"text": json.dumps({"general": [{"id": "gen_1", "category": "general", "question": "Tell me about your Python experience.", "suggested_structure": "STAR", "star_guidance": "Reference Beta Labs.", "grounded_profile_reference": "Beta Labs"}], "role_specific": [], "technical": [], "behavioral": []}), "usage": None},
        ]

        with (
            patch("utils.auth.decode_and_verify_jwt", return_value={"sub": self.uid, "email": "synthetic@example.com"}),
            patch("utils.auth.fetch_authenticated_supabase_user", return_value={"id": self.uid, "email": "synthetic@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z"}),
            patch("routes.jobs.get_user_client", return_value=fake_client),
            patch("routes.documents.get_user_client", return_value=fake_client),
            patch("routes.interviews.get_user_client", return_value=fake_client),
            patch("routes.jobs.get_full_profile", return_value=profile_bundle),
            patch("routes.documents.get_full_profile", return_value=profile_bundle),
            patch("routes.interviews.get_full_profile", return_value=profile_bundle),
            patch("routes.jobs.enforce_daily_ai_quota", return_value=None),
            patch("routes.documents.enforce_daily_ai_quota", return_value=None),
            patch("routes.interviews.enforce_daily_ai_quota", return_value=None),
            patch("routes.jobs.record_usage", return_value=None),
            patch("routes.documents.record_usage", return_value=None),
            patch("routes.interviews.record_usage", return_value=None),
            patch("routes.jobs.record_notification", return_value=None),
            patch("routes.documents.record_notification", return_value=None),
            patch("routes.interviews.record_notification", return_value=None),
            patch("services.gemini_service.GeminiService.from_app_config", return_value=mock_gemini),
        ):
            r_ana = self.client.post("/api/jobs/analyze", json={"job_id": self.job_id}, headers=self.auth_headers)
            self.assertEqual(r_ana.status_code, 200)

            r_cmp = self.client.post(f"/api/jobs/{self.job_id}/compatibility", headers=self.auth_headers)
            self.assertEqual(r_cmp.status_code, 200)
            self.assertEqual(r_cmp.get_json()["data"]["compatibility"]["alignment_score"], 85)

            r_doc = self.client.post(
                "/api/documents/generate",
                json={"mode": "guided", "job_opportunity_id": self.job_id, "document_types": ["cover_letter"]},
                headers=self.auth_headers,
            )
            self.assertEqual(r_doc.status_code, 201)

            r_int = self.client.post(
                "/api/interviews/generate",
                json={"job_opportunity_id": self.job_id},
                headers=self.auth_headers,
            )
            self.assertEqual(r_int.status_code, 201)


if __name__ == "__main__":
    unittest.main()
