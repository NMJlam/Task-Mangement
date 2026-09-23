ALTER TABLE "event" DROP CONSTRAINT "event_uuid_shape_check";--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "proposed_count" integer;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "kept_count" integer;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "edited_count" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "ai_run_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_counts_non_negative_check" CHECK (("ai_run"."proposed_count" IS NULL OR "ai_run"."proposed_count" >= 0)
          AND ("ai_run"."kept_count" IS NULL OR "ai_run"."kept_count" >= 0)
          AND ("ai_run"."edited_count" IS NULL OR "ai_run"."edited_count" >= 0));--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_kept_within_proposed_check" CHECK ("ai_run"."kept_count" IS NULL OR "ai_run"."proposed_count" IS NULL
          OR "ai_run"."kept_count" <= "ai_run"."proposed_count");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_uuid_shape_check" CHECK (("event"."id" IS NULL OR "event"."id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$') AND ("event"."owner" IS NULL OR "event"."owner"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$') AND ("event"."ai_run_id" IS NULL OR "event"."ai_run_id"::text ~ '^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$'));