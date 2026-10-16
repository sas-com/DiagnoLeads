CREATE TABLE "agency_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"agency_name" text NOT NULL,
	"kind" text NOT NULL,
	"campaign" text,
	"disabled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_links_code_unique" UNIQUE("code"),
	CONSTRAINT "agency_links_kind_check" CHECK ("agency_links"."kind" IN ('telemarketing_agency', 'referral_agency'))
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "agency_link_id" uuid;--> statement-breakpoint
ALTER TABLE "agency_links" ADD CONSTRAINT "agency_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_links" ADD CONSTRAINT "agency_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_links_organization_idx" ON "agency_links" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_agency_link_id_agency_links_id_fk" FOREIGN KEY ("agency_link_id") REFERENCES "public"."agency_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_links" ENABLE ROW LEVEL SECURITY;
