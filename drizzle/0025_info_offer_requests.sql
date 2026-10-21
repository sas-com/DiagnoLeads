CREATE TABLE "lead_offer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"submission_id" uuid,
	"kind" text NOT NULL,
	"offer_id" text NOT NULL,
	"title" text NOT NULL,
	"scheduled_on" date,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"attended_at" timestamp with time zone,
	"attendance_recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_submission_id_diagnostic_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."diagnostic_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_attendance_recorded_by_users_id_fk" FOREIGN KEY ("attendance_recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_offer_requests_submission_offer_unique" ON "lead_offer_requests" USING btree ("submission_id","kind","offer_id");--> statement-breakpoint
CREATE INDEX "lead_offer_requests_org_lead_idx" ON "lead_offer_requests" USING btree ("organization_id","lead_id");
--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ENABLE ROW LEVEL SECURITY;