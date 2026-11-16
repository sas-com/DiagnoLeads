CREATE TABLE "ai_employee_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employee_memories_path_check" CHECK ("ai_employee_memories"."path" ~ '^/memories(/[a-z0-9][a-z0-9_-]{0,47}){1,2}\.(md|txt)$'),
	CONSTRAINT "ai_employee_memories_content_check" CHECK (char_length("ai_employee_memories"."content") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "ai_employee_memory_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text,
	"changed_by" text NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employee_memory_versions_changed_by_check" CHECK ("ai_employee_memory_versions"."changed_by" IN ('agent', 'user'))
);
--> statement-breakpoint
CREATE TABLE "ai_employee_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"facts" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"level_before" integer NOT NULL,
	"level_after" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employee_reviews_recommendation_check" CHECK ("ai_employee_reviews"."recommendation" IN ('promote', 'keep', 'narrow')),
	CONSTRAINT "ai_employee_reviews_status_check" CHECK ("ai_employee_reviews"."status" IN ('open', 'decided'))
);
--> statement-breakpoint
CREATE TABLE "ai_employee_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" jsonb,
	"steps" integer DEFAULT 0 NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"result_code" text,
	"locked_until" timestamp with time zone,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_employee_sessions_kind_check" CHECK ("ai_employee_sessions"."kind" IN ('onboarding', 'review')),
	CONSTRAINT "ai_employee_sessions_status_check" CHECK ("ai_employee_sessions"."status" IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_employee_sessions_result_code_check" CHECK ("ai_employee_sessions"."result_code" IS NULL OR "ai_employee_sessions"."result_code" ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "ai_employees" ADD COLUMN "level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_employees" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_employees" ADD COLUMN "level_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_employees" ADD COLUMN "policy" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_employee_memories" ADD CONSTRAINT "ai_employee_memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_memories" ADD CONSTRAINT "ai_employee_memories_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_memory_versions" ADD CONSTRAINT "ai_employee_memory_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_memory_versions" ADD CONSTRAINT "ai_employee_memory_versions_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_memory_versions" ADD CONSTRAINT "ai_employee_memory_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_memory_versions" ADD CONSTRAINT "ai_employee_memory_versions_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_employee_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_reviews" ADD CONSTRAINT "ai_employee_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_reviews" ADD CONSTRAINT "ai_employee_reviews_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_reviews" ADD CONSTRAINT "ai_employee_reviews_session_id_ai_employee_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_employee_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_reviews" ADD CONSTRAINT "ai_employee_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" ADD CONSTRAINT "ai_employee_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" ADD CONSTRAINT "ai_employee_sessions_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" ADD CONSTRAINT "ai_employee_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_employee_memories_employee_path_unique" ON "ai_employee_memories" USING btree ("employee_id","path");--> statement-breakpoint
CREATE INDEX "ai_employee_memory_versions_employee_created_idx" ON "ai_employee_memory_versions" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_employee_reviews_employee_created_idx" ON "ai_employee_reviews" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_employee_sessions_employee_created_idx" ON "ai_employee_sessions" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_employee_sessions_one_open" ON "ai_employee_sessions" USING btree ("employee_id") WHERE "ai_employee_sessions"."status" IN ('running', 'waiting');--> statement-breakpoint
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_level_check" CHECK ("ai_employees"."level" BETWEEN 0 AND 4);--> statement-breakpoint
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_policy_check" CHECK (char_length("ai_employees"."policy") <= 400);--> statement-breakpoint
ALTER TABLE "ai_employee_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_employee_memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_employee_memory_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_employee_reviews" ENABLE ROW LEVEL SECURITY;
