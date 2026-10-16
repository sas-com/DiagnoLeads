ALTER TABLE "leads" ADD COLUMN "agency_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_cost" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deal_phase_reached_at" jsonb DEFAULT '{}'::jsonb NOT NULL;