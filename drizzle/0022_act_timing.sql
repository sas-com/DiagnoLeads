ALTER TABLE "lead_tasks" DROP CONSTRAINT "lead_tasks_source_check";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "act_by" date;--> statement-breakpoint
CREATE INDEX "leads_org_act_by_idx" ON "leads" USING btree ("organization_id","act_by");--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_source_check" CHECK ("lead_tasks"."source" in ('manual', 'hearing', 'meeting_request', 'act_timing'));