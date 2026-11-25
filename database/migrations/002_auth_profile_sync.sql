-- ==============================================================================
-- Migration 002: Auth Email Verification & Profile Synchronisation
-- Keeps public.profiles synchronised with Supabase auth.users verification and
-- email updates, and backfills any pre-existing auth.users rows.
-- ==============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Ensure new users receive email_verified_at if already confirmed at creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, email_verified_at)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
            NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
            ''
        ),
        COALESCE(NEW.email, ''),
        NEW.email_confirmed_at
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(NULLIF(EXCLUDED.email, ''), public.profiles.email),
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
        email_verified_at = COALESCE(EXCLUDED.email_verified_at, public.profiles.email_verified_at);
    RETURN NEW;
END;
$$;

-- Sync verification timestamp and email changes from auth.users -> public.profiles
CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    resolved_name text;
BEGIN
    resolved_name := COALESCE(
        NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
        ''
    );
    UPDATE public.profiles
    SET
        email = COALESCE(NEW.email, email),
        email_verified_at = COALESCE(NEW.email_confirmed_at, email_verified_at),
        full_name = CASE
            WHEN (full_name IS NULL OR full_name = '') AND resolved_name <> ''
            THEN resolved_name
            ELSE full_name
        END
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE OF email, email_confirmed_at, raw_user_meta_data ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_updated();

-- Backfill any pre-existing auth.users missing a profile row
INSERT INTO public.profiles (id, full_name, email, email_verified_at)
SELECT
    u.id,
    COALESCE(
        NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(u.raw_user_meta_data ->> 'name', ''),
        ''
    ),
    COALESCE(u.email, ''),
    u.email_confirmed_at
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    email_verified_at = COALESCE(EXCLUDED.email_verified_at, public.profiles.email_verified_at);

INSERT INTO public.schema_migrations (version)
VALUES ('002_auth_profile_sync')
ON CONFLICT (version) DO NOTHING;
