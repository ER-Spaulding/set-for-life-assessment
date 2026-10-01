-- Emulate the roles Supabase provisions in every project, so migrations that
-- reference them can be executed and verified on a plain PostgreSQL instance.
DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Placeholder credential for a role that exists only on a throwaway local
-- database. NOT a secret: this file is committed, and the value is never used
-- to authenticate against anything. Spelled out so a secret scanner's hit on
-- the word "PASSWORD" is self-evidently a false positive.
DO $$ BEGIN CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'local-emulation-only-not-a-secret'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
-- Supabase also exposes auth.uid() backed by a JWT claim. Emulate it so
-- policies written against auth.uid() can be created and exercised.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
  $fn$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('request.jwt.claim.email', true), '');
  $fn$;
