ALTER TABLE "channel" DROP CONSTRAINT "channel_uuid_shape_check";--> statement-breakpoint
ALTER TABLE "ai_run" DROP CONSTRAINT "ai_run_channel_id_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_run" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "proposal_status" text;--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN "seed_event_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_seed_event_id_event_id_fk" FOREIGN KEY ("seed_event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_kind_check" CHECK ("ai_run"."kind" IN ('chat', 'briefing', 'summary'));--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_proposal_status_check" CHECK ("ai_run"."proposal_status" IS NULL OR "ai_run"."proposal_status" IN ('open', 'applied', 'discarded'));--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_proposal_status_only_on_chat_check" CHECK ("ai_run"."proposal_status" IS NULL OR "ai_run"."kind" = 'chat');--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_seed_only_on_ai_check" CHECK ("channel"."seed_event_id" IS NULL OR "channel"."kind" = 'ai');--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_uuid_shape_check" CHECK (("channel"."id" IS NULL OR "channel"."id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$') AND ("channel"."event_id" IS NULL OR "channel"."event_id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$') AND ("channel"."team_id" IS NULL OR "channel"."team_id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$') AND ("channel"."seed_event_id" IS NULL OR "channel"."seed_event_id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$'));--> statement-breakpoint
-- Data: name each existing run, then drop the old one-per-member Assistant
-- conversations (spec M11). This must follow the foreign-key change above: with
-- the old ON DELETE CASCADE the runs would go with their channels.
UPDATE "ai_run" SET "kind" = 'briefing' WHERE "prompt" = 'Daily briefing';--> statement-breakpoint
UPDATE "ai_run" SET "kind" = 'summary' WHERE "prompt" LIKE 'Summarise thread %';--> statement-breakpoint
DELETE FROM "channel" WHERE "kind" = 'ai';
