CREATE TABLE "meeting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"submission_id" uuid,
	"candidates" jsonb NOT NULL,
	"attendee_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meeting_format" text,
	"confirmed_on" date,
	"confirmed_time" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmation_emailed_at" timestamp with time zone,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_requests_format_check" CHECK ("meeting_requests"."meeting_format" IS NULL OR "meeting_requests"."meeting_format" IN ('onsite', 'online'))
);
--> statement-breakpoint
ALTER TABLE "lead_tasks" DROP CONSTRAINT "lead_tasks_source_check";--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_submission_id_diagnostic_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."diagnostic_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_task_id_lead_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."lead_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_requests_lead_unique" ON "meeting_requests" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "meeting_requests_organization_idx" ON "meeting_requests" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_source_check" CHECK ("lead_tasks"."source" in ('manual', 'hearing', 'meeting_request'));--> statement-breakpoint
ALTER TABLE "meeting_requests" ENABLE ROW LEVEL SECURITY;