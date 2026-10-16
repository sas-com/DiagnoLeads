CREATE TABLE "agency_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agency_name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"initial_fee" integer DEFAULT 0 NOT NULL,
	"monthly_fee" integer DEFAULT 0 NOT NULL,
	"prepayment" integer DEFAULT 0 NOT NULL,
	"fee_per_appointment" integer DEFAULT 0 NOT NULL,
	"plan_appointments" integer,
	"plan_cost_per_appointment" integer,
	"note" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_contracts_term_check" CHECK ("agency_contracts"."ends_on" IS NULL OR "agency_contracts"."ends_on" >= "agency_contracts"."starts_on"),
	CONSTRAINT "agency_contracts_fees_check" CHECK ("agency_contracts"."initial_fee" >= 0 AND "agency_contracts"."monthly_fee" >= 0 AND "agency_contracts"."prepayment" >= 0 AND "agency_contracts"."fee_per_appointment" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD CONSTRAINT "agency_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD CONSTRAINT "agency_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_contracts" ADD CONSTRAINT "agency_contracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_contracts_organization_idx" ON "agency_contracts" USING btree ("organization_id","agency_name");--> statement-breakpoint
ALTER TABLE "agency_contracts" ENABLE ROW LEVEL SECURITY;
