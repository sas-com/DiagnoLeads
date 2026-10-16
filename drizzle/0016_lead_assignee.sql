ALTER TABLE "leads" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_assignee_user_id_idx" ON "leads" USING btree ("assignee_user_id");