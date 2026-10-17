CREATE TABLE "appointment_review_notices" (
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"deadline_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_review_notices_lead_id_deadline_on_pk" PRIMARY KEY("lead_id","deadline_on")
);
--> statement-breakpoint
CREATE TABLE "appointment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"meeting_on" date NOT NULL,
	"deadline_on" date,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions_met" boolean NOT NULL,
	"defect_reason" text,
	"claim" text,
	"recorded_late" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_reviews_claim_check" CHECK ("appointment_reviews"."claim" IS NULL OR "appointment_reviews"."claim" IN ('return', 'retake'))
);
--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD COLUMN "appointment_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD COLUMN "return_deadline_business_days" integer;--> statement-breakpoint
ALTER TABLE "appointment_review_notices" ADD CONSTRAINT "appointment_review_notices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_review_notices" ADD CONSTRAINT "appointment_review_notices_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reviews" ADD CONSTRAINT "appointment_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reviews" ADD CONSTRAINT "appointment_reviews_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reviews" ADD CONSTRAINT "appointment_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reviews" ADD CONSTRAINT "appointment_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_review_notices_organization_idx" ON "appointment_review_notices" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_reviews_lead_unique" ON "appointment_reviews" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "appointment_reviews_organization_idx" ON "appointment_reviews" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD CONSTRAINT "agency_contracts_return_deadline_check" CHECK ("agency_contracts"."return_deadline_business_days" IS NULL OR "agency_contracts"."return_deadline_business_days" BETWEEN 0 AND 30);--> statement-breakpoint
ALTER TABLE "appointment_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_review_notices" ENABLE ROW LEVEL SECURITY;