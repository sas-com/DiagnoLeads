CREATE TABLE "public_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD COLUMN "continued_from_submission_id" uuid;--> statement-breakpoint
CREATE INDEX "public_rate_limits_reset_at_idx" ON "public_rate_limits" USING btree ("reset_at");--> statement-breakpoint
ALTER TABLE "diagnostic_submissions" ADD CONSTRAINT "diagnostic_submissions_continued_from_fk" FOREIGN KEY ("continued_from_submission_id") REFERENCES "public"."diagnostic_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_rate_limits" ENABLE ROW LEVEL SECURITY;
