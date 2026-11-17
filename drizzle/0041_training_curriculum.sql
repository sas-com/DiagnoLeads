CREATE TABLE "ai_employee_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_version" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employee_trainings_kind_check" CHECK ("ai_employee_trainings"."kind" IN ('common', 'role'))
);
--> statement-breakpoint
CREATE TABLE "ai_training_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_training_templates_scope_check" CHECK ("ai_training_templates"."scope" ~ '^[a-z_]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "ai_employee_trainings" ADD CONSTRAINT "ai_employee_trainings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_trainings" ADD CONSTRAINT "ai_employee_trainings_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_trainings" ADD CONSTRAINT "ai_employee_trainings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_training_templates" ADD CONSTRAINT "ai_training_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_training_templates" ADD CONSTRAINT "ai_training_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_employee_trainings_employee_kind_unique" ON "ai_employee_trainings" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_training_templates_organization_scope_unique" ON "ai_training_templates" USING btree ("organization_id","scope");--> statement-breakpoint
ALTER TABLE "ai_training_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_employee_trainings" ENABLE ROW LEVEL SECURITY;
