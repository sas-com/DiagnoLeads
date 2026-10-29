ALTER TABLE "respondent_email_sends" DROP CONSTRAINT "respondent_email_sends_kind_check";--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "source" text DEFAULT 'result' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "contact" jsonb;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "download_token_hash" text;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "download_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD COLUMN "offer_request_id" uuid;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_offer_request_fk" FOREIGN KEY ("offer_request_id") REFERENCES "public"."lead_offer_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_download_token_hash_unique" UNIQUE("download_token_hash");--> statement-breakpoint
ALTER TABLE "lead_offer_requests" ADD CONSTRAINT "lead_offer_requests_source_check" CHECK ("lead_offer_requests"."source" in ('result', 'landing'));--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_kind_check" CHECK ("respondent_email_sends"."kind" in ('confirmation', 'result', 'document_link'));