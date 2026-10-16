CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_definition" jsonb NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnoses_status_check" CHECK ("diagnoses"."status" IN ('draft', 'published', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "diagnosis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnosis_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"change_summary" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD COLUMN "diagnosis_version_id" uuid;--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD COLUMN "consent" jsonb;--> statement-breakpoint
ALTER TABLE "embed_configs" ADD COLUMN "diagnosis_id" uuid;--> statement-breakpoint
ALTER TABLE "qr_campaigns" ADD COLUMN "diagnosis_id" uuid;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_current_version_id_diagnosis_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."diagnosis_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_versions" ADD CONSTRAINT "diagnosis_versions_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_versions" ADD CONSTRAINT "diagnosis_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_versions" ADD CONSTRAINT "diagnosis_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnoses_org_slug_unique" ON "diagnoses" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "diagnoses_current_version_idx" ON "diagnoses" USING btree ("current_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_versions_diagnosis_version_unique" ON "diagnosis_versions" USING btree ("diagnosis_id","version");--> statement-breakpoint
CREATE INDEX "diagnosis_versions_org_idx" ON "diagnosis_versions" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD CONSTRAINT "diagnostic_submissions_diagnosis_version_fk" FOREIGN KEY ("diagnosis_version_id") REFERENCES "public"."diagnosis_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_configs" ADD CONSTRAINT "embed_configs_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_campaigns" ADD CONSTRAINT "qr_campaigns_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_submissions_diagnosis_version_idx" ON "diagnostic_submissions" USING btree ("diagnosis_version_id");--> statement-breakpoint
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diagnosis_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Published versions are immutable (#114). UPDATE is always rejected. DELETE only happens as part
-- of deleting the diagnosis or the organization (ON DELETE CASCADE); the parent row is already
-- gone when the cascade reaches this table.
CREATE OR REPLACE FUNCTION "public"."diagnosis_versions_immutable"() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'diagnosis_versions rows cannot be updated' USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."diagnoses" WHERE "id" = OLD."diagnosis_id")
    AND EXISTS (SELECT 1 FROM "public"."organizations" WHERE "id" = OLD."organization_id") THEN
    RAISE EXCEPTION 'diagnosis_versions rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "diagnosis_versions_immutable" BEFORE UPDATE OR DELETE ON "diagnosis_versions"
  FOR EACH ROW EXECUTE FUNCTION "public"."diagnosis_versions_immutable"();--> statement-breakpoint
-- A diagnosis that was ever published is archived, not deleted, so its versions (which answers
-- refer to) stay. Deleting the whole organization still removes everything.
CREATE OR REPLACE FUNCTION "public"."diagnoses_keep_published"() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."diagnosis_versions" WHERE "diagnosis_id" = OLD."id")
    AND EXISTS (SELECT 1 FROM "public"."organizations" WHERE "id" = OLD."organization_id") THEN
    RAISE EXCEPTION 'a published diagnosis cannot be deleted; archive it instead' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "diagnoses_keep_published" BEFORE DELETE ON "diagnoses"
  FOR EACH ROW EXECUTE FUNCTION "public"."diagnoses_keep_published"();
