-- Pin search_path on the RLS helper functions from 0000 (#359, Supabase advisor
-- function_search_path_mutable). Three of them are SECURITY DEFINER, so an unpinned search_path
-- would let the caller choose which organization_members they read. Same names, arguments and
-- return types, so the policies that call them are unchanged; table names are now schema-qualified.
CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.user_organization_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT organization_id
  FROM "public"."organization_members"
  WHERE user_id = app.user_id();
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_organization_member(org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "public"."organization_members"
    WHERE organization_id = org_id
      AND user_id = app.user_id()
  );
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.user_role_in_organization(org_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role
  FROM "public"."organization_members"
  WHERE organization_id = org_id
    AND user_id = app.user_id()
  LIMIT 1;
$$;
