CREATE TABLE "prospect_meeting_targets" (
	"organization_id" uuid NOT NULL,
	"month" date NOT NULL,
	"meetings" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_meeting_targets_organization_id_month_pk" PRIMARY KEY("organization_id","month"),
	CONSTRAINT "prospect_meeting_targets_meetings_check" CHECK ("prospect_meeting_targets"."meetings" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contacted_on" date NOT NULL,
	"entry" text NOT NULL,
	"company" text NOT NULL,
	"department" text,
	"job_title" text,
	"surname" text,
	"explained_on" date,
	"heard" text,
	"system_scope" text,
	"reaction" text,
	"next_step" text,
	"target_system" text,
	"support_end_soon" text,
	"troubles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_action_on" date,
	"next_action_note" text,
	"recorder_name" text,
	"stage" text,
	"meeting_on" date,
	"sales_user_id" uuid,
	"remarks" text,
	"handed_over_at" timestamp with time zone,
	"lead_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_links" DROP CONSTRAINT "agency_links_kind_check";--> statement-breakpoint
ALTER TABLE "agency_links" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect_meeting_targets" ADD CONSTRAINT "prospect_meeting_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_meeting_targets" ADD CONSTRAINT "prospect_meeting_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_sales_user_id_users_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_organization_idx" ON "prospects" USING btree ("organization_id","contacted_on");--> statement-breakpoint
CREATE INDEX "prospects_lead_idx" ON "prospects" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "agency_links" ADD CONSTRAINT "agency_links_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_links_member_active_unique" ON "agency_links" USING btree ("organization_id","member_user_id") WHERE "agency_links"."kind" = 'member_referral' AND "agency_links"."disabled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "agency_links" ADD CONSTRAINT "agency_links_kind_check" CHECK ("agency_links"."kind" IN ('telemarketing_agency', 'referral_agency', 'member_referral'));--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospect_meeting_targets" ENABLE ROW LEVEL SECURITY;
