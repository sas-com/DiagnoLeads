CREATE TABLE "field_glossary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_key" text NOT NULL,
	"value" text,
	"label_ja" text,
	"label_en" text,
	"description_ja" text,
	"description_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_glossary" ADD CONSTRAINT "field_glossary_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_glossary_field_value_unique" ON "field_glossary" USING btree ("field_key","value") WHERE "field_glossary"."value" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "field_glossary_field_unique" ON "field_glossary" USING btree ("field_key") WHERE "field_glossary"."value" is null;