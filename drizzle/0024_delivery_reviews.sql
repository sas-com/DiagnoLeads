CREATE TABLE "lead_delivery_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"checkpoint_outcomes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actual_difficulty" text,
	"estimated_effort" numeric(7, 1),
	"actual_effort" numeric(7, 1),
	"note" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_delivery_reviews" ADD CONSTRAINT "lead_delivery_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_delivery_reviews" ADD CONSTRAINT "lead_delivery_reviews_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_delivery_reviews" ADD CONSTRAINT "lead_delivery_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_delivery_reviews" ADD CONSTRAINT "lead_delivery_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_delivery_reviews_lead_unique" ON "lead_delivery_reviews" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_delivery_reviews_organization_idx" ON "lead_delivery_reviews" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "lead_delivery_reviews" ENABLE ROW LEVEL SECURITY;