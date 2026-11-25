-- ==============================================================================
-- Migration 001: Initial CareerCraft AI Schema
-- Run in Supabase SQL Editor or via Supabase CLI migrations.
-- ==============================================================================
-- This migration mirrors database/schema.sql for ordered migration tracking.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- Execute database/schema.sql first, then record migration:
INSERT INTO public.schema_migrations (version)
VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;
