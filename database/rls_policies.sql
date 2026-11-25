-- ==============================================================================
-- CareerCraft AI — Row Level Security (RLS) Policies
-- Enforce strict per-user isolation on every table.
-- ==============================================================================

-- Enable RLS on all user-owned tables
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

-- ------------------------------------------------------------------------------
-- 1. profiles (ownership via id = auth.uid())
-- ------------------------------------------------------------------------------
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_own"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 2. career_experience
-- ------------------------------------------------------------------------------
CREATE POLICY "career_experience_select_own"
    ON public.career_experience FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "career_experience_insert_own"
    ON public.career_experience FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "career_experience_update_own"
    ON public.career_experience FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "career_experience_delete_own"
    ON public.career_experience FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 3. education
-- ------------------------------------------------------------------------------
CREATE POLICY "education_select_own"
    ON public.education FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "education_insert_own"
    ON public.education FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "education_update_own"
    ON public.education FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "education_delete_own"
    ON public.education FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 4. skills
-- ------------------------------------------------------------------------------
CREATE POLICY "skills_select_own"
    ON public.skills FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "skills_insert_own"
    ON public.skills FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "skills_update_own"
    ON public.skills FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "skills_delete_own"
    ON public.skills FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 5. projects
-- ------------------------------------------------------------------------------
CREATE POLICY "projects_select_own"
    ON public.projects FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "projects_insert_own"
    ON public.projects FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_update_own"
    ON public.projects FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_delete_own"
    ON public.projects FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 6. certifications
-- ------------------------------------------------------------------------------
CREATE POLICY "certifications_select_own"
    ON public.certifications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "certifications_insert_own"
    ON public.certifications FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "certifications_update_own"
    ON public.certifications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "certifications_delete_own"
    ON public.certifications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 7. uploaded_cvs
-- ------------------------------------------------------------------------------
CREATE POLICY "uploaded_cvs_select_own"
    ON public.uploaded_cvs FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "uploaded_cvs_insert_own"
    ON public.uploaded_cvs FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "uploaded_cvs_update_own"
    ON public.uploaded_cvs FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "uploaded_cvs_delete_own"
    ON public.uploaded_cvs FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 8. job_opportunities
-- ------------------------------------------------------------------------------
CREATE POLICY "job_opportunities_select_own"
    ON public.job_opportunities FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "job_opportunities_insert_own"
    ON public.job_opportunities FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "job_opportunities_update_own"
    ON public.job_opportunities FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "job_opportunities_delete_own"
    ON public.job_opportunities FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 9. job_analyses (also verifies parent job_opportunity belongs to auth.uid())
-- ------------------------------------------------------------------------------
CREATE POLICY "job_analyses_select_own"
    ON public.job_analyses FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "job_analyses_insert_own"
    ON public.job_analyses FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.job_opportunities jo
            WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
        )
    );

CREATE POLICY "job_analyses_update_own"
    ON public.job_analyses FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.job_opportunities jo
            WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
        )
    );

CREATE POLICY "job_analyses_delete_own"
    ON public.job_analyses FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 10. applications
-- ------------------------------------------------------------------------------
CREATE POLICY "applications_select_own"
    ON public.applications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "applications_insert_own"
    ON public.applications FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND (
            job_opportunity_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.job_opportunities jo
                WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
            )
        )
    );

CREATE POLICY "applications_update_own"
    ON public.applications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND (
            job_opportunity_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.job_opportunities jo
                WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
            )
        )
    );

CREATE POLICY "applications_delete_own"
    ON public.applications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 11. generated_documents
-- ------------------------------------------------------------------------------
CREATE POLICY "generated_documents_select_own"
    ON public.generated_documents FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "generated_documents_insert_own"
    ON public.generated_documents FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND (
            job_opportunity_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.job_opportunities jo
                WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
            )
        )
        AND (
            application_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.applications app
                WHERE app.id = application_id AND app.user_id = auth.uid()
            )
        )
    );

CREATE POLICY "generated_documents_update_own"
    ON public.generated_documents FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND (
            job_opportunity_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.job_opportunities jo
                WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
            )
        )
        AND (
            application_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.applications app
                WHERE app.id = application_id AND app.user_id = auth.uid()
            )
        )
    );

CREATE POLICY "generated_documents_delete_own"
    ON public.generated_documents FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 12. document_versions
-- ------------------------------------------------------------------------------
CREATE POLICY "document_versions_select_own"
    ON public.document_versions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "document_versions_insert_own"
    ON public.document_versions FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.generated_documents gd
            WHERE gd.id = document_id AND gd.user_id = auth.uid()
        )
    );

CREATE POLICY "document_versions_delete_own"
    ON public.document_versions FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 13. usage_records (Read-only for authenticated user; writes only via service_role)
-- ------------------------------------------------------------------------------
CREATE POLICY "usage_records_select_own"
    ON public.usage_records FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Intentionally NO INSERT/UPDATE/DELETE policies for 'authenticated' or 'anon' roles.
-- Only backend Flask requests using SUPABASE_SERVICE_ROLE_KEY may record usage.

-- ------------------------------------------------------------------------------
-- 14. notifications (Users may read, mark as read, or delete; backend creates)
-- ------------------------------------------------------------------------------
CREATE POLICY "notifications_select_own"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications_delete_own"
    ON public.notifications FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 15. interview_sessions
-- ------------------------------------------------------------------------------
CREATE POLICY "interview_sessions_select_own"
    ON public.interview_sessions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "interview_sessions_insert_own"
    ON public.interview_sessions FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.job_opportunities jo
            WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
        )
    );

CREATE POLICY "interview_sessions_update_own"
    ON public.interview_sessions FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.job_opportunities jo
            WHERE jo.id = job_opportunity_id AND jo.user_id = auth.uid()
        )
    );

CREATE POLICY "interview_sessions_delete_own"
    ON public.interview_sessions FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
