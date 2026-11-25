# CareerCraft AI

**One profile. Every opportunity. A smarter application.**

CareerCraft AI is an AI-powered career application preparation platform (not a job board or recruitment marketplace). Users build a confirmed career profile, upload an existing CV, paste a job description they independently found, and generate tailored, factually grounded application documents.

---

## Technology Stack

- **Frontend:** HTML5, CSS3 (CSS Grid, Flexbox, Custom Properties), Vanilla JavaScript (ES Modules, Fetch API)
- **Backend:** Python 3.11+, Flask, Flask Blueprints, Gunicorn
- **Auth, Database & Storage:** Supabase Auth, Supabase PostgreSQL (with Row Level Security), Private Supabase Storage Buckets
- **AI Integration:** Google Gemini API (`google-genai` Python SDK, backend-only)
- **Document Processing (Phases 4 & 7):** PyMuPDF, `python-docx`, ReportLab

> **Preview Runtime Note:** Google AI Studio serves the `frontend/` HTML5/CSS3/Vanilla JS preview on port 3000 via Vite MPA, and its Python container does not include `pip` or Flask packages pre-installed. All Flask backend and PostgreSQL/Supabase migration files are generated in `backend/` and `database/` for local execution and external Python hosting.

---

## Project Structure

```text
careercraft-ai/
├── frontend/                  # Pure HTML5, CSS3, Vanilla JS application
│   ├── index.html             # Public landing page
│   ├── features.html          # Features overview
│   ├── how-it-works.html      # 6-step workflow overview
│   ├── about.html             # Product mission & strict non-fabrication rules
│   ├── free-access.html       # Free initial release & fair safeguards
│   ├── login.html             # Sign in page (Supabase Auth)
│   ├── register.html          # Registration page (Supabase Auth)
│   ├── verify-email.html      # Email verification & resend handler
│   ├── forgot-password.html   # Password recovery request
│   ├── reset-password.html    # Password reset completion
│   ├── onboarding.html        # Protected onboarding page
│   ├── dashboard.html         # Protected dashboard page
│   ├── access-denied.html     # Access denied system page
│   ├── session-expired.html   # Session expired system page
│   ├── privacy.html           # Privacy Policy (draft for legal review)
│   ├── terms.html             # Terms of Use (draft for legal review)
│   ├── 404.html               # Not Found system page
│   ├── css/                   # variables.css, global.css, components.css, landing.css, dashboard.css, responsive.css
│   ├── js/                    # config.js, supabase-client.js, route-guard.js, api.js, auth.js, onboarding.js, dashboard.js, utils.js
│   └── assets/                # logo.svg
├── backend/                   # Python Flask REST API
│   ├── app.py                 # Application factory, CORS, security headers, Blueprint registration
│   ├── config.py              # Environment configuration & validation
│   ├── requirements.txt       # Python dependencies
│   ├── routes/                # Modular Flask Blueprints (including auth.py)
│   ├── services/              # supabase_service.py, gemini_service.py, usage_service.py
│   ├── utils/                 # auth.py (JWKS), errors.py, security.py, validators.py
│   └── tests/                 # Automated unit & API tests
├── database/                  # Supabase PostgreSQL SQL definitions
│   ├── schema.sql             # All 15 tables, composite FKs, triggers, indexes
│   ├── migrations/            # Ordered SQL migration scripts
│   ├── rls_policies.sql       # Strict per-user Row Level Security policies
│   └── storage_policies.sql   # Private bucket definitions & ownership policies
├── .env.example               # Environment variable placeholders
├── .gitignore
├── README.md
└── DEPLOYMENT.md
```

---

## Local Setup (Starting from an Empty Environment)

### 1. Prerequisites
- Python **3.11+** (`python3 --version`)
- Node.js **20+** (only if serving `frontend/` via Vite; any static HTTP server works)
- A **Supabase** project
- A **Google Gemini API** key

### 2. Clone & Configure Environment Variables
```bash
cp .env.example .env
```

Edit `.env` with your real credentials:

| Variable | Required | Scope | Description |
| :--- | :--- | :--- | :--- |
| `FLASK_ENV` | Mandatory | Backend | `development` locally, `production` when deployed |
| `FLASK_SECRET_KEY` | Mandatory | Backend | Random 64-char hex string (`python3 -c "import secrets; print(secrets.token_hex(32))"`) |
| `SUPABASE_URL` | Mandatory | Public + Backend | Supabase Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | Mandatory | Public + Backend | Supabase public publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Mandatory | **Backend Only** | Supabase secret server key (`sb_secret_...`, never expose to browser) |
| `SUPABASE_JWKS_URL` | Mandatory | **Backend Only** | Supabase JWKS endpoint (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`) |
| `GEMINI_API_KEY` | Mandatory | **Backend Only** | Google Gemini API key (never expose to browser) |
| `GEMINI_MODEL` | Mandatory | Backend | Model ID (e.g. `gemini-2.5-flash`) |
| `FRONTEND_URL` | Mandatory | Backend | URL where frontend is served (e.g. `http://localhost:3000`) |
| `ALLOWED_ORIGINS` | Mandatory | Backend | Comma-separated CORS origins (e.g. `http://localhost:3000`) |
| `BACKEND_API_URL` | Optional | Public Runtime | Flask backend URL for frontend API requests (default: `http://127.0.0.1:5000`) |
| `MAX_UPLOAD_SIZE_MB` | Optional | Backend | Max CV upload size in MB (default: `10`) |
| `AI_DAILY_REQUEST_LIMIT` | Optional | Backend | Daily AI calls per user (default: `30`) |
| `AI_REQUEST_TIMEOUT` | Optional | Backend | Gemini request timeout in seconds (default: `45`) |

### 3. Supabase Database & Storage Setup
Run the SQL files in your Supabase **SQL Editor** in this exact order:
1. `database/schema.sql`
2. `database/migrations/001_initial_schema.sql`
3. `database/migrations/002_auth_profile_sync.sql`
4. `database/rls_policies.sql`
5. `database/storage_policies.sql`

### 4. Supabase Authentication Configuration
In **Supabase Dashboard → Authentication**:
- Enable **Email** provider and require **Confirm email** (`Enable email confirmations`).
- Configure an SMTP provider for production email verification & password recovery.
- Add redirect URLs under **URL Configuration** (both local and your deployed/AI Studio URL):
  - `http://localhost:3000/verify-email.html`
  - `http://localhost:3000/reset-password.html`
  - `https://<your-app-domain>/verify-email.html`
  - `https://<your-app-domain>/reset-password.html`

### 5. Backend Startup (Flask)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
The Flask API starts on `http://127.0.0.1:5000`. Verify via `GET http://127.0.0.1:5000/api/health`.

### 6. Frontend Startup
Serve `frontend/` on port 3000:
```bash
npm install
npm run dev
```
Or with Python's built-in static server:
```bash
python3 -m http.server 3000 --directory frontend
```

### 7. Running Tests
```bash
cd backend
pytest -v
```
Or using Python's built-in `unittest` for pure-stdlib foundation checks:
```bash
python3 -m unittest discover -s backend/tests -p "test_foundation.py" -v
```

---

## Platform Modules Implemented

- **Foundation & Security:** Responsive CSS3 design system, Flask API factory, CORS & security headers, JWKS RS256/ES256 verification, server-side daily AI quota safeguard.
- **Authentication & Onboarding:** Real Supabase Auth (registration, email verification, resend, login, forgot/reset password, logout), safe loading-gate route guards, and 7-step career profile onboarding with step resumption.
- **Career Profile & CV Management:** Complete CRUD for personal details, summary/objective, experience, education, skills, projects, certifications, languages, and links; private PDF/DOCX CV upload, magic-byte validation, PyMuPDF/python-docx extraction, Gemini parsing, and safe non-overwriting merge.
- **Job Analysis, Compatibility & Application Studio:** User-supplied job description analysis, transparent profile compatibility scoring, Quick & Guided generation of 7 document types across 4 layout templates.
- **Document Editor, Tracker, Interview Prep & Settings:** Live document editor & template preview, immutable version history/restore, genuine binary PDF (ReportLab) and DOCX export, private Application Tracker, STAR-guided Interview Preparation, notifications, quota meter, and permanent account deletion.
