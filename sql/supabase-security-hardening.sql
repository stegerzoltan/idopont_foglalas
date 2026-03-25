-- Supabase security hardening for this project.
-- Safe to run multiple times.

BEGIN;

DO $$
DECLARE
  table_name TEXT;
  target_tables TEXT[] := ARRAY[
    'classes',
    'signups',
    'notifications',
    'users',
    'push_subscriptions',
    'passes',
    'pass_uses'
  ];
BEGIN
  FOREACH table_name IN ARRAY target_tables
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END
$$;

-- Remove direct table/sequence/function access from API roles.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Optional extra hardening on schema-level permissions.
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- Keep future objects locked down as well.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;
