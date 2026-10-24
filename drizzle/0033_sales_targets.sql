CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"month" date NOT NULL,
	"amount" bigint NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_targets_amount_check" CHECK ("sales_targets"."amount" >= 0),
	CONSTRAINT "sales_targets_month_check" CHECK (extract(day from "sales_targets"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_member_month_unique" ON "sales_targets" USING btree ("organization_id","user_id","month") WHERE "sales_targets"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_organization_month_unique" ON "sales_targets" USING btree ("organization_id","month") WHERE "sales_targets"."user_id" is null;--> statement-breakpoint
CREATE INDEX "sales_targets_user_idx" ON "sales_targets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;