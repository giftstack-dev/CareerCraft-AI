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
2. Execute `database/schema.sql`, `database/migrations/001_initial_schema.sql`, `database/rls_policies.sql`, and `database/storage_policies.sql` in the SQL Editor.
3. Verify in **Storage → Buckets** that `uploaded-cvs` and `generated-documents` exist and are marked **Private** (`public = false`).
4. Under **Authentication → Providers → Email**, keep **Confirm email** enabled.
5. Configure a reliable custom SMTP provider so verification and recovery emails are delivered consistently.
6. Set **Site URL** to your production `FRONTEND_URL` and add exact redirect URLs for `/verify-email.html` and `/reset-password.html`.

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
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `FRONTEND_URL=https://your-frontend-domain`
- `ALLOWED_ORIGINS=https://your-frontend-domain`

Verify `GET https://your-backend-domain/api/health` returns `200 OK` with `supabase_configured: true` and `gemini_configured: true`.

---

## 4. Deploying the Frontend
1. Update `frontend/js/config.js` (or inject `window.__CAREERCRAFT_CONFIG__`) with only the three public values:
   - `apiBaseUrl`: `https://your-backend-domain`
   - `supabaseUrl`: `https://your-project.supabase.co`
   - `supabaseAnonKey`: your public Supabase anon key
2. Deploy `frontend/` (or `npm run build` output in `dist/`) to HTTPS static hosting (Cloudflare Pages, Netlify, Vercel static, or Nginx).

---

## 5. Production Security Checklist
- [ ] HTTPS enforced for both frontend and backend.
- [ ] `ALLOWED_ORIGINS` restricted strictly to production frontend origin(s) — never `*`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `FLASK_SECRET_KEY` absent from frontend files and Git history.
- [ ] Row Level Security enabled on all 15 PostgreSQL tables.
- [ ] Storage buckets `uploaded-cvs` and `generated-documents` confirmed private.
- [ ] Email verification and password recovery redirect URLs tested end-to-end.
