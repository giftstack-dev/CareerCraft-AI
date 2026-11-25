-- ==============================================================================
-- CareerCraft AI — Complete Initial Database Schema (PostgreSQL / Supabase)
-- Version: 1.0 (Phase 1 Foundation)
-- Authoritative Identity Source: Supabase auth.users
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- Shared Trigger Function: Automatically update updated_at timestamp
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 1. profiles
-- Stores core personal identity, summary, and onboarding state per auth user.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    phone text,
    country text,
    city text,
    professional_title text,
    professional_summary text,
    career_objective text,
    portfolio_url text,
    professional_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    languages jsonb NOT NULL DEFAULT '[]'::jsonb,
    onboarding_status text NOT NULL DEFAULT 'not_started'
        CHECK (onboarding_status IN ('not_started', 'in_progress', 'completed', 'skipped')),
    onboarding_step integer NOT NULL DEFAULT 1 CHECK (onboarding_step >= 1 AND onboarding_step <= 7),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Automatically initialize profile row when a new auth.users record is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(NEW.email, '')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 2. career_experience
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.career_experience (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    employer text NOT NULL,
    job_title text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    is_current boolean NOT NULL DEFAULT false,
    responsibilities jsonb NOT NULL DEFAULT '[]'::jsonb,
    achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_experience_dates CHECK (
        is_current = true OR end_date IS NULL OR end_date >= start_date
    )
);

CREATE INDEX IF NOT EXISTS idx_career_experience_user_id ON public.career_experience(user_id);

DROP TRIGGER IF EXISTS trg_career_experience_updated_at ON public.career_experience;
CREATE TRIGGER trg_career_experience_updated_at
    BEFORE UPDATE ON public.career_experience
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 3. education
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.education (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    institution text NOT NULL,
    qualification text NOT NULL,
    field_of_study text,
    start_date date,
    end_date date,
    achievements text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_education_dates CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    )
);

CREATE INDEX IF NOT EXISTS idx_education_user_id ON public.education(user_id);

DROP TRIGGER IF EXISTS trg_education_updated_at ON public.education;
CREATE TRIGGER trg_education_updated_at
    BEFORE UPDATE ON public.education
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 4. skills
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    skill_name text NOT NULL,
    skill_category text NOT NULL DEFAULT 'technical'
        CHECK (skill_category IN ('technical', 'soft', 'tool', 'industry', 'language')),
    proficiency text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_skill UNIQUE (user_id, skill_name, skill_category)
);

CREATE INDEX IF NOT EXISTS idx_skills_user_id ON public.skills(user_id);

DROP TRIGGER IF EXISTS trg_skills_updated_at ON public.skills;
CREATE TRIGGER trg_skills_updated_at
    BEFORE UPDATE ON public.skills
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 5. projects
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_title text NOT NULL,
    description text NOT NULL,
    personal_contribution text,
    tools jsonb NOT NULL DEFAULT '[]'::jsonb,
    project_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 6. certifications
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.certifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    certification_name text NOT NULL,
    issuing_organisation text NOT NULL,
    issue_date date,
    credential_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON public.certifications(user_id);

DROP TRIGGER IF EXISTS trg_certifications_updated_at ON public.certifications;
CREATE TRIGGER trg_certifications_updated_at
    BEFORE UPDATE ON public.certifications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 7. uploaded_cvs
-- Stores metadata and extraction status; binary files remain in private Storage.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uploaded_cvs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_filename text NOT NULL,
    storage_path text NOT NULL UNIQUE,
    mime_type text NOT NULL CHECK (
        mime_type IN (
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    ),
    file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
    parsing_status text NOT NULL DEFAULT 'uploaded'
        CHECK (parsing_status IN ('uploaded', 'extracting', 'parsed', 'failed', 'unreadable')),
    extracted_data jsonb,
    confirmation_status text NOT NULL DEFAULT 'pending_review'
        CHECK (confirmation_status IN ('pending_review', 'partially_confirmed', 'confirmed', 'discarded')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_cvs_user_id ON public.uploaded_cvs(user_id);

DROP TRIGGER IF EXISTS trg_uploaded_cvs_updated_at ON public.uploaded_cvs;
CREATE TRIGGER trg_uploaded_cvs_updated_at
    BEFORE UPDATE ON public.uploaded_cvs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 8. job_opportunities
-- Opportunities supplied independently by the authenticated user.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_opportunities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_name text,
    job_title text,
    original_job_description text NOT NULL,
    additional_instructions text,
    screening_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_job_opportunities_id_user UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_job_opportunities_user_id ON public.job_opportunities(user_id);

DROP TRIGGER IF EXISTS trg_job_opportunities_updated_at ON public.job_opportunities;
CREATE TRIGGER trg_job_opportunities_updated_at
    BEFORE UPDATE ON public.job_opportunities
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 9. job_analyses
-- Structured requirements extraction & explainable compatibility output.
-- Composite FK enforces same-user ownership of referenced job_opportunity.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_analyses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_opportunity_id uuid NOT NULL,
    structured_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
    compatibility_results jsonb,
    analysis_status text NOT NULL DEFAULT 'pending'
        CHECK (analysis_status IN ('pending', 'completed', 'failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_job_analyses_opportunity_owner
        FOREIGN KEY (job_opportunity_id, user_id)
        REFERENCES public.job_opportunities(id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_analyses_user_id ON public.job_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_job_analyses_job_id ON public.job_analyses(job_opportunity_id);

DROP TRIGGER IF EXISTS trg_job_analyses_updated_at ON public.job_analyses;
CREATE TRIGGER trg_job_analyses_updated_at
    BEFORE UPDATE ON public.job_analyses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 10. applications
-- Private tracker for user-identified job applications.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_opportunity_id uuid,
    company_name text NOT NULL,
    job_title text NOT NULL,
    application_date date,
    status text NOT NULL DEFAULT 'Saved'
        CHECK (status IN (
            'Saved',
            'Preparing',
            'Applied',
            'Interview',
            'Assessment',
            'Offer Received',
            'Not Selected'
        )),
    notes text,
    interview_date timestamptz,
    follow_up_date date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_applications_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_applications_opportunity_owner
        FOREIGN KEY (job_opportunity_id, user_id)
        REFERENCES public.job_opportunities(id, user_id)
        ON DELETE SET NULL (job_opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(user_id, status);

DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.applications;
CREATE TRIGGER trg_applications_updated_at
    BEFORE UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 11. generated_documents
-- Editable structured document content & approval workflow.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_opportunity_id uuid,
    application_id uuid,
    document_type text NOT NULL CHECK (
        document_type IN (
            'cv',
            'cover_letter',
            'screening_response',
            'personal_statement',
            'statement_of_purpose',
            'professional_bio',
            'other'
        )
    ),
    document_title text NOT NULL,
    structured_content jsonb NOT NULL DEFAULT '{}'::jsonb,
    template text NOT NULL DEFAULT 'classic_professional' CHECK (
        template IN (
            'classic_professional',
            'modern_minimalist',
            'technical_engineering',
            'graduate_entry_level'
        )
    ),
    document_status text NOT NULL DEFAULT 'draft'
        CHECK (document_status IN ('draft', 'reviewed', 'approved')),
    validation_info jsonb NOT NULL DEFAULT '{}'::jsonb,
    storage_references jsonb NOT NULL DEFAULT '{}'::jsonb,
    current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_generated_documents_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_documents_opportunity_owner
        FOREIGN KEY (job_opportunity_id, user_id)
        REFERENCES public.job_opportunities(id, user_id)
        ON DELETE SET NULL (job_opportunity_id),
    CONSTRAINT fk_documents_application_owner
        FOREIGN KEY (application_id, user_id)
        REFERENCES public.applications(id, user_id)
        ON DELETE SET NULL (application_id)
);

CREATE INDEX IF NOT EXISTS idx_generated_documents_user_id ON public.generated_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_type ON public.generated_documents(user_id, document_type);

DROP TRIGGER IF EXISTS trg_generated_documents_updated_at ON public.generated_documents;
CREATE TRIGGER trg_generated_documents_updated_at
    BEFORE UPDATE ON public.generated_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 12. document_versions
-- Immutable version snapshots for document restoration & auditability.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id uuid NOT NULL,
    version_number integer NOT NULL CHECK (version_number >= 1),
    content_snapshot jsonb NOT NULL,
    template_snapshot text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_document_version UNIQUE (document_id, version_number),
    CONSTRAINT fk_versions_document_owner
        FOREIGN KEY (document_id, user_id)
        REFERENCES public.generated_documents(id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc_id ON public.document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_user_id ON public.document_versions(user_id);

-- ------------------------------------------------------------------------------
-- 13. usage_records
-- Server-controlled AI safeguard tracking. Protected against client writes.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    operation_type text NOT NULL,
    ai_model text NOT NULL,
    request_status text NOT NULL CHECK (
        request_status IN ('pending', 'success', 'failed', 'rate_limited', 'rejected')
    ),
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_created ON public.usage_records(user_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 14. notifications
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read, created_at DESC);

-- ------------------------------------------------------------------------------
-- 15. interview_sessions
-- Persistent interview preparation sessions tied to user-supplied opportunities.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_opportunity_id uuid NOT NULL,
    questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    practice_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_interview_sessions_opportunity_owner
        FOREIGN KEY (job_opportunity_id, user_id)
        REFERENCES public.job_opportunities(id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_id ON public.interview_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_job_id ON public.interview_sessions(job_opportunity_id);

DROP TRIGGER IF EXISTS trg_interview_sessions_updated_at ON public.interview_sessions;
CREATE TRIGGER trg_interview_sessions_updated_at
    BEFORE UPDATE ON public.interview_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
