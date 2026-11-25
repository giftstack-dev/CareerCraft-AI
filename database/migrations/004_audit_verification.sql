-- ==============================================================================
-- Migration 004: Idempotent Schema, Permissions, Indexes & RLS Audit Verification
-- Non-destructive verification safe to execute on existing production databases.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Ensure supporting indexes exist for high-frequency user-scoped queries
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_status
    ON public.profiles(onboarding_status);

CREATE INDEX IF NOT EXISTS idx_uploaded_cvs_user_created
    ON public.uploaded_cvs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_documents_app_id
    ON public.generated_documents(application_id);

CREATE INDEX IF NOT EXISTS idx_generated_documents_job_id
    ON public.generated_documents(job_opportunity_id);

-- Ensure authenticated role holds least-privilege grants alongside RLS
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.profiles,
    public.career_experience,
    public.education,
    public.skills,
    public.projects,
    public.certifications,
    public.uploaded_cvs,
    public.job_opportunities,
    public.job_analyses,
    public.applications,
    public.generated_documents,
    public.interview_sessions
TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.document_versions TO authenticated;
GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;
GRANT SELECT ON TABLE public.usage_records TO authenticated;
REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;

-- Verify RLS is active on all public schema tables
ALTER TABLE IF EXISTS public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_cvs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version)
VALUES ('004_audit_verification')
ON CONFLICT (version) DO NOTHING;
