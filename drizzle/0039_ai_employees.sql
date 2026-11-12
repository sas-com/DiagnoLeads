CREATE TABLE "ai_employee_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid,
	"role" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"result_code" text,
	CONSTRAINT "ai_employee_runs_trigger_check" CHECK ("ai_employee_runs"."trigger" IN ('schedule', 'manual')),
	CONSTRAINT "ai_employee_runs_result_code_check" CHECK ("ai_employee_runs"."result_code" IS NULL OR "ai_employee_runs"."result_code" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "ai_employee_runs_status_check" CHECK ("ai_employee_runs"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employees_status_check" CHECK ("ai_employees"."status" IN ('active', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "ai_employee_runs" ADD CONSTRAINT "ai_employee_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_runs" ADD CONSTRAINT "ai_employee_runs_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_employee_runs_employee_started_idx" ON "ai_employee_runs" USING btree ("employee_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_employee_runs_organization_started_idx" ON "ai_employee_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_employees_organization_role_unique" ON "ai_employees" USING btree ("organization_id","role");