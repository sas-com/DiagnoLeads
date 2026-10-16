ALTER TABLE "lead_tasks" ADD COLUMN "kind" text DEFAULT 'next_action' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "check_with" text;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "check_with_user_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "notified_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "notified_overdue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_check_with_user_id_users_id_fk" FOREIGN KEY ("check_with_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_kind_check" CHECK ("lead_tasks"."kind" in ('next_action', 'takeaway'));