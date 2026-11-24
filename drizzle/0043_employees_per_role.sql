ALTER TABLE "ai_employees" ADD COLUMN "seat" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_employees_organization_role_seat_unique" ON "ai_employees" USING btree ("organization_id","role","seat");--> statement-breakpoint
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_seat_check" CHECK ("ai_employees"."seat" BETWEEN 0 AND 2);