CREATE TABLE "site_visit_daily" (
	"organization_id" uuid NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"page_type" text NOT NULL,
	"visitors" integer NOT NULL,
	"pageviews" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_visit_daily_organization_id_day_path_pk" PRIMARY KEY("organization_id","day","path")
);
--> statement-breakpoint
CREATE TABLE "site_visit_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"path" text NOT NULL,
	"page_type" text NOT NULL,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"from_ref" text,
	"device" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_visits_device_check" CHECK ("site_visits"."device" in ('desktop', 'mobile', 'tablet'))
);
--> statement-breakpoint
ALTER TABLE "site_visit_daily" ADD CONSTRAINT "site_visit_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_visits_org_day_idx" ON "site_visits" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX "site_visits_org_path_day_idx" ON "site_visits" USING btree ("organization_id","path","day");--> statement-breakpoint
CREATE INDEX "site_visits_created_at_idx" ON "site_visits" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "site_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_visit_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_visit_salts" ENABLE ROW LEVEL SECURITY;