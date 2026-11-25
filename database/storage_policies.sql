-- ==============================================================================
-- CareerCraft AI — Supabase Private Storage Buckets & Ownership Policies
-- Buckets:
--   1. uploaded-cvs        (path: <user_id>/<cv_id>/<safe_filename>)
--   2. generated-documents (path: <user_id>/<doc_id>/<version>/<safe_filename>)
-- ==============================================================================

-- Create private buckets (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'uploaded-cvs',
    'uploaded-cvs',
    false,
    10485760, -- 10 MB
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'generated-documents',
    'generated-documents',
    false,
    15728640, -- 15 MB
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------------------------
-- Policies for 'uploaded-cvs'
-- First path segment MUST equal auth.uid()::text
-- ------------------------------------------------------------------------------
CREATE POLICY "uploaded_cvs_storage_select_own"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'uploaded-cvs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "uploaded_cvs_storage_insert_own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'uploaded-cvs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "uploaded_cvs_storage_update_own"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'uploaded-cvs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'uploaded-cvs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "uploaded_cvs_storage_delete_own"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'uploaded-cvs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- ------------------------------------------------------------------------------
-- Policies for 'generated-documents'
-- First path segment MUST equal auth.uid()::text
-- ------------------------------------------------------------------------------
CREATE POLICY "generated_documents_storage_select_own"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'generated-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "generated_documents_storage_insert_own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'generated-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "generated_documents_storage_update_own"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'generated-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'generated-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "generated_documents_storage_delete_own"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'generated-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
