CREATE TABLE "lead_contact_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_contact_logs_kind_check" CHECK ("lead_contact_logs"."kind" in ('call', 'email', 'no_answer'))
);
--> statement-breakpoint
CREATE TABLE "lead_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text,
	"note" text,
	"due_on" date NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"assignee_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_hearing_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tasks_source_check" CHECK ("lead_tasks"."source" in ('manual', 'hearing'))
);
--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_source_hearing_id_lead_hearings_id_fk" FOREIGN KEY ("source_hearing_id") REFERENCES "public"."lead_hearings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_contact_logs_org_lead_contacted_idx" ON "lead_contact_logs" USING btree ("organization_id","lead_id","contacted_at");--> statement-breakpoint
CREATE INDEX "lead_contact_logs_lead_idx" ON "lead_contact_logs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_org_lead_idx" ON "lead_tasks" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_org_open_due_idx" ON "lead_tasks" USING btree ("organization_id","due_on") WHERE "lead_tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "lead_tasks_lead_idx" ON "lead_tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_tasks_source_hearing_idx" ON "lead_tasks" USING btree ("source_hearing_id") WHERE "lead_tasks"."source_hearing_id" is not null;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_tasks" ENABLE ROW LEVEL SECURITY;
