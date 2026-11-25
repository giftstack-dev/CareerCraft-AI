-- ==============================================================================
-- Migration 003: Explicit Schema, Table, Sequence & Function GRANT Permissions
-- Ensures Supabase PostgREST roles ('authenticated', 'service_role') and auth
-- triggers execute cleanly with least-privilege isolation.
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Revoke broad defaults from anon on user tables
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Full backend service_role access across all tables, sequences, and functions
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Authenticated user CRUD permissions (strictly bounded by RLS policies)
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

-- Document versions: read, create, delete (immutable snapshots)
GRANT SELECT, INSERT, DELETE ON TABLE public.document_versions TO authenticated;

-- Notifications: users may read, mark as read, or dismiss (created by backend)
GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;

-- Usage records: read-only for authenticated users (writes strictly server-side)
GRANT SELECT ON TABLE public.usage_records TO authenticated;

-- Schema migrations: service_role / postgres only
REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;

-- Ensure trigger functions can execute cleanly
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, service_role;

INSERT INTO public.schema_migrations (version)
VALUES ('003_grants_and_permissions')
ON CONFLICT (version) DO NOTHING;
