CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"send_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_reason_check" CHECK ("email_suppressions"."reason" in ('unsubscribed', 'not_requested', 'bounced', 'complained', 'staff')),
	CONSTRAINT "email_suppressions_source_check" CHECK ("email_suppressions"."source" in ('one_click', 'unsubscribe_page', 'confirm_page', 'resend_webhook', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "respondent_email_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"submission_id" uuid,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locale" text NOT NULL,
	"confirm_token_hash" text,
	"confirm_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "respondent_email_consents_confirm_token_hash_unique" UNIQUE("confirm_token_hash"),
	CONSTRAINT "respondent_email_consents_purpose_check" CHECK ("respondent_email_consents"."purpose" in ('ax_result_copy')),
	CONSTRAINT "respondent_email_consents_locale_check" CHECK ("respondent_email_consents"."locale" in ('ja', 'en'))
);
--> statement-breakpoint
CREATE TABLE "respondent_email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"consent_id" uuid,
	"lead_id" uuid,
	"submission_id" uuid,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"resend_message_id" text,
	"unsubscribe_token_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "respondent_email_sends_unsubscribe_token_hash_unique" UNIQUE("unsubscribe_token_hash"),
	CONSTRAINT "respondent_email_sends_kind_check" CHECK ("respondent_email_sends"."kind" in ('confirmation', 'result')),
	CONSTRAINT "respondent_email_sends_status_check" CHECK ("respondent_email_sends"."status" in ('pending', 'sent', 'failed', 'suppressed', 'quota'))
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_send_id_respondent_email_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."respondent_email_sends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_consents" ADD CONSTRAINT "respondent_email_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_consents" ADD CONSTRAINT "respondent_email_consents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_consents" ADD CONSTRAINT "respondent_email_consents_submission_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."diagnostic_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_consent_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."respondent_email_consents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ADD CONSTRAINT "respondent_email_sends_submission_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."diagnostic_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_org_email_unique" ON "email_suppressions" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "respondent_email_consents_org_email_idx" ON "respondent_email_consents" USING btree ("organization_id","email","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "respondent_email_consents_submission_purpose_unique" ON "respondent_email_consents" USING btree ("submission_id","purpose");--> statement-breakpoint
CREATE INDEX "respondent_email_consents_lead_idx" ON "respondent_email_consents" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "respondent_email_sends_org_email_idx" ON "respondent_email_sends" USING btree ("organization_id","email","created_at");--> statement-breakpoint
CREATE INDEX "respondent_email_sends_lead_idx" ON "respondent_email_sends" USING btree ("lead_id");
--> statement-breakpoint
ALTER TABLE "respondent_email_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "respondent_email_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;