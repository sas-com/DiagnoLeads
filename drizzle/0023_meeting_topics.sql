ALTER TABLE "meeting_requests" ADD COLUMN "topics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD COLUMN "topic_note" text;