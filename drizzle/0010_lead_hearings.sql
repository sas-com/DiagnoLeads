CREATE TABLE "lead_hearings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"held_on" date NOT NULL,
	"catalog_version" integer NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prefill" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_hearings" ADD CONSTRAINT "lead_hearings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_hearings" ADD CONSTRAINT "lead_hearings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_hearings" ADD CONSTRAINT "lead_hearings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_hearings" ADD CONSTRAINT "lead_hearings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_hearings_org_lead_held_on_idx" ON "lead_hearings" USING btree ("organization_id","lead_id","held_on");--> statement-breakpoint
CREATE INDEX "lead_hearings_lead_idx" ON "lead_hearings" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "lead_hearings" ENABLE ROW LEVEL SECURITY;
