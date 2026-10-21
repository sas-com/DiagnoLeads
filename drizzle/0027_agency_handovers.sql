CREATE TABLE "agency_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"agency_name" text,
	"appointment_on" date,
	"contact_name" text,
	"contact_title" text,
	"contact_phone" text,
	"machine_model" text,
	"machine_model_confirmed" boolean,
	"hardware_support_end" text,
	"retirement_plan" text,
	"decision_maker_present" text,
	"interest_level" text,
	"refusal_reason" text,
	"note" text,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_handovers" ADD CONSTRAINT "agency_handovers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_handovers" ADD CONSTRAINT "agency_handovers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_handovers" ADD CONSTRAINT "agency_handovers_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_handovers_lead_unique" ON "agency_handovers" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "agency_handovers_organization_idx" ON "agency_handovers" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "agency_handovers" ENABLE ROW LEVEL SECURITY;