# CareerCraft AI — Production Deployment Guide

## Architecture Overview
CareerCraft AI separates:
1. **Static Frontend (`frontend/`):** HTML5, CSS3, and Vanilla JavaScript deployed to a static host or CDN (or served alongside Flask).
2. **Flask Backend (`backend/`):** Python 3.11+ REST API running under Gunicorn behind HTTPS.
3. **Managed Data & Auth:** Supabase Auth, Supabase PostgreSQL, and Private Supabase Storage buckets.
4. **AI Processing:** Google Gemini API invoked exclusively from the Flask backend.

> **Important Note on Google AI Studio:** Google AI Studio serves the frontend preview and does not host a long-running Python Flask backend or install Python packages (`pip` is unavailable in the container). Deploy `backend/` to a Python-capable host such as Cloud Run, Render, Railway, or Fly.io.

---

## 1. Supabase Production Configuration
1. Create a production Supabase project in your target region.
2. Execute the SQL files in order in the Supabase SQL Editor:
   1. `database/schema.sql`
   2. `database/migrations/001_initial_schema.sql`
   3. `database/migrations/002_auth_profile_sync.sql`
   4. `database/migrations/003_grants_and_permissions.sql`
   5. `database/rls_policies.sql`
   6. `database/storage_policies.sql`
3. Verify in **Storage → Buckets** that `uploaded-cvs` and `generated-documents` exist and are marked **Private** (`public = false`).
4. Under **Authentication → Providers → Email**, keep **Confirm email** enabled.
5. **Configure Brevo Custom SMTP** under **Project Settings → Authentication → SMTP Settings** so verification and password recovery emails deliver reliably without hitting Supabase's built-in email cap:
   - Toggle **Enable Custom SMTP** on.
   - **Host:** `smtp-relay.brevo.com`
   - **Port number:** `587`
   - **Username:** Your Brevo SMTP login email (from Brevo **SMTP & API → SMTP**)
   - **Password:** Your Brevo SMTP Key (not your account login password; store only inside Supabase Dashboard)
   - **Sender email:** A verified sender address in Brevo (e.g., `noreply@yourdomain.com` or your verified Brevo sender)
   - **Sender name:** `CareerCraft AI`
   - **Minimum interval per user:** `60` seconds (aligned with the frontend 60-second resend/recovery cooldowns)
6. **Configure Google OAuth** under **Google Cloud Console → APIs & Services → Credentials** and **Supabase → Authentication → Providers → Google**:
   - In Google Cloud Console, configure the **OAuth consent screen** (External), add scopes `openid`, `email`, `profile`, and add your authorized domain (`supabase.co` and `yourcareercraft.netlify.app`).
   - Create an **OAuth client ID** (Web application) with:
     - **Authorized JavaScript origins:** `https://yourcareercraft.netlify.app` and `https://oznvkjvwzzfcjtmdwkls.supabase.co`
     - **Authorized redirect URI (exact):** `https://oznvkjvwzzfcjtmdwkls.supabase.co/auth/v1/callback`
   - Paste the **Client ID** and **Client Secret** into **Supabase → Authentication → Providers → Google** and toggle **Enable Sign in with Google** on.
7. Under **Supabase → Authentication → URL Configuration**:
   - **Site URL:** `https://yourcareercraft.netlify.app`
   - **Redirect URLs:**
     - `https://yourcareercraft.netlify.app/auth-callback.html`
     - `https://yourcareercraft.netlify.app/verify-email.html`
     - `https://yourcareercraft.netlify.app/reset-password.html`
     - `http://localhost:3000/auth-callback.html`
     - `http://localhost:3000/verify-email.html`
     - `http://localhost:3000/reset-password.html`

---

## 2. Gemini API Configuration
1. Generate a Gemini API key in Google AI Studio / Google Cloud.
2. Store `GEMINI_API_KEY` solely in the backend hosting platform's secret manager.
3. Set `GEMINI_MODEL` (for example, `gemini-2.5-flash`), `AI_DAILY_REQUEST_LIMIT`, and `AI_REQUEST_TIMEOUT`.
4. Never place `GEMINI_API_KEY` in `frontend/js/config.js` or any client-visible environment variable.

---

## 3. Deploying the Flask Backend
Use Gunicorn with explicit timeouts and multiple workers:
```bash
cd backend
gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 60 "app:create_app()"
```

Set all required production environment variables on the backend host:
- `FLASK_ENV=production`
- `FLASK_SECRET_KEY=<64-char random hex>`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWKS_URL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `FRONTEND_URL=https://your-frontend-domain`
- `ALLOWED_ORIGINS=https://your-frontend-domain`

Verify `GET https://your-backend-domain/api/health` returns `200 OK` with `supabase_configured: true` and `gemini_configured: true`.

---

## 4. Deploying the Frontend
1. Provide ONLY the three public values to the frontend build/runtime (`runtime-config.js` or `GET /api/auth/config`):
   - `apiBaseUrl`: `https://your-backend-domain`
   - `supabaseUrl`: `https://your-project.supabase.co`
   - `supabasePublishableKey`: your public Supabase publishable key
2. Deploy `frontend/` (or `npm run build` output in `dist/`) to HTTPS static hosting (Cloudflare Pages, Netlify, Vercel static, or Nginx).

---

## 5. Production Security Checklist
- [ ] HTTPS enforced for both frontend and backend.
- [ ] `ALLOWED_ORIGINS` restricted strictly to production frontend origin(s) — never `*`.
- [ ] `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, and `FLASK_SECRET_KEY` absent from frontend files and Git history.
- [ ] Row Level Security enabled on all 15 PostgreSQL tables.
- [ ] Storage buckets `uploaded-cvs` and `generated-documents` confirmed private.
- [ ] Email verification and password recovery redirect URLs tested end-to-end.
