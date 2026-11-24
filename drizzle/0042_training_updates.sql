CREATE TABLE "ai_training_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"version" integer NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_training_template_versions_scope_check" CHECK ("ai_training_template_versions"."scope" ~ '^[a-z_]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" DROP CONSTRAINT "ai_employee_sessions_kind_check";--> statement-breakpoint
ALTER TABLE "ai_training_template_versions" ADD CONSTRAINT "ai_training_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_training_template_versions" ADD CONSTRAINT "ai_training_template_versions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_training_template_versions_unique" ON "ai_training_template_versions" USING btree ("organization_id","scope","version");--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" ADD CONSTRAINT "ai_employee_sessions_kind_check" CHECK ("ai_employee_sessions"."kind" IN ('onboarding', 'review', 'refresher'));--> statement-breakpoint
INSERT INTO "ai_training_template_versions" ("organization_id", "scope", "version", "sections", "created_by", "created_at") SELECT "organization_id", "scope", "version", "sections", "updated_by", "updated_at" FROM "ai_training_templates";--> statement-breakpoint
ALTER TABLE "ai_training_template_versions" ENABLE ROW LEVEL SECURITY;
