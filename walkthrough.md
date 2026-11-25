# Security Summary

**Reviewed Files**: 46 (backend routes, backend services, auth/security utilities, SQL schema & migrations, frontend API/auth/workspace scripts, HTML pages, and Netlify/Vite build configuration)
**Issues Resolved**: 6 (4 `Fixed` in code, 2 `Needs Follow-Up` for external hosting & Supabase dashboard actions)

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Privileged Database Client in User Routes | `backend/services/supabase_service.py` | 16–51 | User-facing routes called `get_secret_client()` (`SUPABASE_SECRET_KEY`), bypassing PostgreSQL and Storage Row-Level Security policies instead of scoping queries to the verified caller's JWT. | High | Fixed | Added `get_user_client(access_token)` using `SUPABASE_PUBLISHABLE_KEY` plus the verified Bearer JWT (`g.access_token`) and switched all user CRUD/AI/storage routes and `profile_service.py` to `get_user_client()`. |
| CV Storage Path Validation | `backend/routes/cv.py` | 200–202, 450–453 | `parse_cv()` and `delete_cv()` read or deleted storage objects directly from database-stored paths without re-validating strict `<user_id>/<cv_id>/<filename>` ownership and traversal constraints prior to Storage SDK calls. | Medium | Fixed | Added `validate_user_storage_path(storage_path, user_id)` (`backend/utils/security.py:36`) immediately before `.download()` and `.remove()` calls in `cv.py`. |
| Unhandled Connectivity Probe & PostgREST Query Crashes | `backend/routes/dashboard.py`, `backend/routes/auth.py` | 116–129, 79–126 | Uncaught probe exceptions could bubble into HTTP 500 on `/api/health/connectivity`, and `.insert(...).select()` / `.update(...).select()` chaining crashed on `postgrest-py` v2+, interrupting auth bootstrap and profile sync. | Medium | Fixed | Wrapped every connectivity probe in `_safe_probe()` so `/api/health/connectivity` always returns structured health status, and removed all chained `.select()` calls after `.insert()`/`.update()`/`.upsert()` across backend routes. |
| Mutating Request Retries & Error Masking | `frontend/js/api.js`, `frontend/js/workspace-utils.js` | 12–15, 233; 38–42 | Retrying timed-out `POST`/`PUT`/`DELETE` requests risks duplicate AI calls or mutations, and binary export fallback previously retried proxy URLs even after definitive 4xx responses. | Medium | Fixed | Restricted automatic retries in `apiRequest` exclusively to idempotent methods (`GET`, `HEAD`, `OPTIONS`), added strict `payload.success === true` validation, and marked 4xx export responses `fatal` so fallback URLs are not retried. |
| AI Document Factual Grounding Verification | `backend/services/grounding_service.py`, `backend/routes/documents.py` | 1–260, 282–307 | Generated drafts relied purely on prompt instructions without deterministic post-generation auditing against confirmed profile data, risking unverified metrics, years, contacts, or employers slipping through unseen. | Medium | Fixed | Created deterministic `verify_document_grounding()` audit stored in `validation_info.grounding_report` and displayed in both Application Studio and Document Editor review panels. |
| External Deployment & Provider Configuration | `database/migrations/004_audit_verification.sql`, `netlify.toml` | 1–50 | Updated code fixes are present in the repository, while live Render, Netlify, Supabase SQL migration `004`, Google OAuth provider credentials, and Brevo SMTP require manual deployment/dashboard updates. | Medium | Needs Follow-Up | Deploy the updated backend and frontend, run `004_audit_verification.sql` in Supabase SQL Editor, set Netlify public env vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`), and configure Google OAuth + Brevo SMTP in Supabase Auth. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Secrets Separation | `backend/routes/auth.py`, `frontend/js/config.js` | `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, and Flask `SECRET_KEY` remain strictly on the backend; `/api/auth/config` and `/runtime-config.js` expose only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. |
| JWT Signature & Email Verification | `backend/utils/auth.py` | Enforces asymmetric JWKS verification (`ES256`, `RS256`, `EdDSA`), issuer/audience/exp claims validation, and confirmed-email enforcement (`403 email_not_verified`) on all protected routes. |
| XSS-Safe DOM Rendering | `frontend/js/workspace-utils.js`, `frontend/js/*.js` | Workspace UI elements are built exclusively with `document.createElement` / `textContent` (`el()`), avoiding raw HTML string injection (`innerHTML`) on user or AI-generated content. |
| Private Storage & File Validation | `backend/services/cv_parser_service.py`, `backend/routes/cv.py` | Uploaded CVs verify magic bytes (`%PDF-` / `PK\x03\x04`), sanitize filenames (`sanitize_filename`), confine paths to `<user_id>/<cv_id>/`, and use private `uploaded-cvs` bucket policies. |
| CORS & Security Headers | `backend/app.py`, `backend/utils/security.py` | Explicit origin allowlist (no wildcard `*` with credentials) plus `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cache-Control: no-store`, and production HSTS headers. |

---

## PoC Verification

### 1. User-Scoped Database Queries Enforcing RLS (`get_user_client`)
#### Summary
| Field | Value |
|---|---|
| Issue Type | Over-Privileged Database Client on User Routes |
| Impact | High |
| Affected File | `backend/services/supabase_service.py:16-38`, `backend/routes/jobs.py`, `backend/routes/documents.py`, `backend/routes/profile.py` |
| Test Scenario | Verified user sends `GET /api/documents` or `DELETE /api/documents/<other-user-doc-id>` with a valid Bearer JWT belonging to User A |

#### How It Was Fixed
Protected routes extract the verified Bearer JWT into `g.access_token` inside `require_auth` (`backend/utils/auth.py:124`) and instantiate a user-scoped Supabase client via `get_user_client()` (`backend/services/supabase_service.py:16-38`) using `SUPABASE_PUBLISHABLE_KEY` + `client.postgrest.auth(token)` instead of `SUPABASE_SECRET_KEY`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Request enters `@require_auth(require_verified_email=True)` (`backend/utils/auth.py:102`) | Bearer token extracted and verified against `SUPABASE_JWKS_URL`. |
| 2 | Middleware stores verified JWT (`backend/utils/auth.py:124`) | `g.access_token` holds caller JWT; `g.current_user.user_id` holds `sub`. |
| 3 | Route handler calls `get_user_client()` (`backend/routes/documents.py:429`) | Client authenticates to PostgREST as `authenticated` role with caller's `auth.uid()`, not `service_role`. |
| 4 | Query applies `.eq("user_id", user_id)` AND PostgreSQL evaluates RLS policy (`auth.uid() = user_id`) | Cross-user document access is blocked at both application filter and PostgreSQL RLS layers (**Handled Safely**). |

#### Conclusion
**Fix Verified** - Cross-tenant queries cannot bypass PostgreSQL Row-Level Security because user-facing routes no longer execute under `SUPABASE_SECRET_KEY`.

---

### 2. Storage Path Traversal & Ownership Confinement on CV Operations
#### Summary
| Field | Value |
|---|---|
| Issue Type | Path Traversal / Unvalidated Storage Key Access |
| Impact | Medium |
| Affected File | `backend/utils/security.py:36-43`, `backend/routes/cv.py:118-123, 200-202, 450-453` |
| Test Scenario | Attempted storage path `11111111-.../../22222222-.../cv-123/resume.pdf` or filename `../../etc/passwd` |

#### How It Was Fixed
Uploaded filenames pass through `sanitize_filename()` (`backend/utils/security.py:27-33`), and every upload, parse download, and delete validates `validate_user_storage_path(storage_path, user_id)` (`backend/utils/security.py:36-43`) before calling Supabase Storage.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Malicious filename `../../etc/passwd` arrives at `upload_cv()` (`backend/routes/cv.py:118`) | `sanitize_filename()` calls `os.path.basename` and strips traversal characters -> `"passwd"`. |
| 2 | Crafted `storage_path` containing `..`, leading `/`, or mismatched `user_id` enters `parse_cv()` (`backend/routes/cv.py:201`) | `validate_user_storage_path()` checks `not ".." in path`, `not startswith("/")`, `len(parts) >= 3`, and `parts[0] == str(user_id)`. |
| 3 | Validation fails and raises `ValidationError("Invalid stored CV path.")` | Storage `.download()` / `.remove()` is never invoked (**Handled Safely**). |

#### Conclusion
**Fix Verified** - Verified by `TestSecurityPathAndFilenameValidation` unit tests confirming traversal payloads and cross-user paths are rejected prior to Storage access.

---

### 3. Non-Idempotent Mutation Retry Prevention & 4xx Export Guard
#### Summary
| Field | Value |
|---|---|
| Issue Type | Duplicate Mutating Requests / Unnecessary Fallback Retries |
| Impact | Medium |
| Affected File | `frontend/js/api.js:12-15, 233-244`, `frontend/js/workspace-utils.js:38-42` |
| Test Scenario | `POST /api/documents/generate` times out during a long AI operation, or `GET /api/documents/<id>/export` returns HTTP `404` |

#### How It Was Fixed
`apiRequest()` checks `isIdempotentMethod(method)` (`frontend/js/api.js:12-15`) and immediately returns without retrying if `!idempotent` (`frontend/js/api.js:233`). Binary exports mark 4xx responses with `httpErr.fatal = true` (`frontend/js/workspace-utils.js:39-41`) so proxy fallback URLs are skipped.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/documents/generate` reaches `apiRequest()` (`frontend/js/api.js:186-187`) | `idempotent` evaluates to `false`. |
| 2 | Network timeout or `504` occurs on first attempt (`frontend/js/api.js:232-236`) | `!idempotent` triggers early return with structured timeout/error message; retry loop is skipped. |
| 3 | Binary export returns `404` on primary URL (`frontend/js/workspace-utils.js:39-41`) | `httpErr.fatal = true` throws out of loop without probing `/api/...` fallback (**Handled Safely**). |

#### Conclusion
**Fix Verified** - Mutating `POST`/`PUT`/`DELETE` actions never auto-replay after timeout, preventing duplicate document generation or quota charges.

---

### 4. Deterministic Post-Generation Factual Grounding Verification
#### Summary
| Field | Value |
|---|---|
| Issue Type | Unverified AI Claims / Missing Profile Grounding Audit |
| Impact | Medium |
| Affected File | `backend/services/grounding_service.py`, `backend/routes/documents.py:282-307` |
| Test Scenario | Draft contains fabricated phone number `+1 555 999 8888`, metric `88%`, year `2016`, and employer `MegaFakeCorp` absent from confirmed profile |

#### How It Was Fixed
Every generated draft passes through `verify_document_grounding()` (`backend/routes/documents.py:282-289`), which compares contact fields, percentages/numbers, 4-digit years, and experience/education entry titles against confirmed profile records and persists `grounding_report` in `validation_info`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Structured AI JSON draft is parsed (`backend/routes/documents.py:260-280`) | Confirmed contact details override header values (`lines 264-273`). |
| 2 | `verify_document_grounding()` inspects header, summary, and section entries (`backend/services/grounding_service.py`) | Flags unconfirmed phone, `%`/`$` metrics, unseen year `2016`, and unconfirmed `MegaFakeCorp` entry. |
| 3 | `verification_status` set to `"needs_review"` with `clarification_prompts` and persisted in `validation_info` | Application Studio and Document Editor display exact warnings to user before approval (**Handled Safely**). |

#### Conclusion
**Fix Verified** - Confirmed by `TestFactualGroundingService` unit tests detecting fabricated claims (`needs_review`) while passing strictly grounded drafts (`verified`).
