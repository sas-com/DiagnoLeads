CREATE TABLE "lead_prep_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"estimated_system" text,
	"estimated_system_basis" text,
	"recent_news" text,
	"hypotheses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_prep_cards" ADD CONSTRAINT "lead_prep_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_prep_cards" ADD CONSTRAINT "lead_prep_cards_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_prep_cards" ADD CONSTRAINT "lead_prep_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_prep_cards" ADD CONSTRAINT "lead_prep_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_prep_cards_lead_unique" ON "lead_prep_cards" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_prep_cards_organization_idx" ON "lead_prep_cards" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "lead_prep_cards" ENABLE ROW LEVEL SECURITY;