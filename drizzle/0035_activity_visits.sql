ALTER TABLE "lead_contact_logs" DROP CONSTRAINT "lead_contact_logs_kind_check";--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_contact_logs_deal_contacted_idx" ON "lead_contact_logs" USING btree ("deal_id","contacted_at");--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_outcome_check" CHECK ("lead_contact_logs"."outcome" in ('advanced', 'no_change', 'setback'));--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_duration_check" CHECK ("lead_contact_logs"."duration_minutes" between 1 and 1440);--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_no_answer_check" CHECK ("lead_contact_logs"."kind" <> 'no_answer' or ("lead_contact_logs"."duration_minutes" is null and "lead_contact_logs"."outcome" is null));--> statement-breakpoint
ALTER TABLE "lead_contact_logs" ADD CONSTRAINT "lead_contact_logs_kind_check" CHECK ("lead_contact_logs"."kind" in ('call', 'email', 'no_answer', 'visit', 'online_meeting'));