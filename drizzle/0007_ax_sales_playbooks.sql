CREATE TABLE "ax_sales_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ax_sales_playbooks_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "ax_sales_playbooks" ADD CONSTRAINT "ax_sales_playbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ax_sales_playbooks" ADD CONSTRAINT "ax_sales_playbooks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ax_sales_playbooks" ENABLE ROW LEVEL SECURITY;
