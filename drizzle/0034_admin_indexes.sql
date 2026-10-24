CREATE INDEX "audit_logs_org_resource_created_idx" ON "audit_logs" USING btree ("organization_id","resource","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_comments_lead_created_idx" ON "lead_comments" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_tags_lead_idx" ON "lead_tags" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_tags_tag_idx" ON "lead_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "notifications_user_org_created_idx" ON "notifications" USING btree ("user_id","organization_id","created_at");