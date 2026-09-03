-- NOTE: Drizzle owns the `public` schema ONLY.
-- The `auth` schema and auth."user" are created by Better Auth's own migration
-- API, which src/db/migrate.ts runs BEFORE this file. drizzle-kit still emits
-- DDL for them because schema/auth.ts declares auth."user" so the app_user
-- foreign key below can be expressed in Drizzle rather than hand-patched.
-- (schemaFilter governs introspection, not generate.) Those two statements are
-- removed here by hand; the FK on line ~215 is the part we want and it stays.
-- Only the BASELINE needs this patch: auth."user" is now in the snapshot, so
-- future db:generate diffs will not re-emit it.
CREATE TABLE "ai_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid,
	"prompt" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_cost_non_negative_check" CHECK ("ai_run"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" text NOT NULL,
	"tier" smallint GENERATED ALWAYS AS (CASE role
          WHEN 'president' THEN 2
          WHEN 'vice_president' THEN 2
          WHEN 'treasurer' THEN 2
          WHEN 'secretary' THEN 2
          WHEN 'director' THEN 1
          WHEN 'officer' THEN 0
        END) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_user_role_check" CHECK ("app_user"."role" IN ('president', 'vice_president', 'treasurer', 'secretary', 'director', 'officer'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chan_member" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chan_member_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"team_id" uuid,
	"kind" text NOT NULL,
	"name" text,
	"min_tier" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_kind_check" CHECK ("channel"."kind" IN ('team', 'event', 'group', 'dm', 'ai')),
	CONSTRAINT "channel_min_tier_range_check" CHECK ("channel"."min_tier" BETWEEN 0 AND 2),
	CONSTRAINT "channel_parent_matches_kind_check" CHECK (CASE "channel"."kind"
        WHEN 'team'  THEN "channel"."team_id"  IS NOT NULL AND "channel"."event_id" IS NULL
        WHEN 'event' THEN "channel"."event_id" IS NOT NULL AND "channel"."team_id"  IS NULL
        ELSE              "channel"."team_id"  IS NULL     AND "channel"."event_id" IS NULL
      END),
	CONSTRAINT "channel_min_tier_only_when_tier_gated_check" CHECK ("channel"."kind" IN ('team', 'event') OR "channel"."min_tier" = 0),
	CONSTRAINT "channel_named_unless_dm_check" CHECK ("channel"."kind" = 'dm' OR ("channel"."name" IS NOT NULL AND length(trim("channel"."name")) > 0))
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'planning' NOT NULL,
	"allocation_cents" bigint DEFAULT 0 NOT NULL,
	"min_tier" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_title_not_blank_check" CHECK (length(trim("event"."title")) > 0),
	CONSTRAINT "event_status_check" CHECK ("event"."status" IN ('planning', 'live', 'wrapped', 'cancelled')),
	CONSTRAINT "event_allocation_non_negative_check" CHECK ("event"."allocation_cents" >= 0),
	CONSTRAINT "event_min_tier_range_check" CHECK ("event"."min_tier" BETWEEN 0 AND 2),
	CONSTRAINT "event_ends_after_start_check" CHECK ("event"."ends_at" IS NULL OR "event"."ends_at" >= "event"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"team_id" uuid,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitter" uuid,
	"decider" uuid,
	"receipt_key" text,
	"rejection_reason" text,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_amount_positive_check" CHECK ("expense"."amount_cents" > 0),
	CONSTRAINT "expense_description_not_blank_check" CHECK (length(trim("expense"."description")) > 0),
	CONSTRAINT "expense_category_check" CHECK ("expense"."category" IN ('catering', 'venue', 'marketing', 'equipment', 'transport', 'printing', 'other')),
	CONSTRAINT "expense_status_check" CHECK ("expense"."status" IN ('pending', 'approved', 'paid', 'rejected')),
	CONSTRAINT "expense_rejection_reason_matches_status_check" CHECK (("expense"."status" = 'rejected') = ("expense"."rejection_reason" IS NOT NULL)),
	CONSTRAINT "expense_decider_is_not_submitter_check" CHECK ("expense"."decider" IS NULL OR "expense"."decider" <> "expense"."submitter"),
	CONSTRAINT "expense_decided_at_matches_status_check" CHECK (("expense"."status" = 'pending') = ("expense"."decided_at" IS NULL)),
	CONSTRAINT "expense_paid_at_matches_status_check" CHECK (("expense"."status" = 'paid') = ("expense"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lead" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_name_unique" UNIQUE("name"),
	CONSTRAINT "team_name_not_blank_check" CHECK (length(trim("team"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "team_member_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_email_lowercase_check" CHECK ("invite"."email" = lower("invite"."email")),
	CONSTRAINT "invite_role_check" CHECK ("invite"."role" IN ('president', 'vice_president', 'treasurer', 'secretary', 'director', 'officer')),
	CONSTRAINT "invite_not_both_accepted_and_revoked_check" CHECK ("invite"."accepted_at" IS NULL OR "invite"."revoked_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "workstream" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"brief" text,
	"lead" uuid,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workstream_one_per_team_per_event" UNIQUE("event_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"team_id" uuid,
	"assignee" uuid,
	"creator" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_at" timestamp with time zone,
	"board_order" integer DEFAULT 0 NOT NULL,
	"min_tier" smallint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_title_not_blank_check" CHECK (length(trim("task"."title")) > 0),
	CONSTRAINT "task_status_check" CHECK ("task"."status" IN ('todo', 'in_progress', 'blocked', 'done')),
	CONSTRAINT "task_priority_check" CHECK ("task"."priority" IN ('low', 'medium', 'high', 'urgent')),
	CONSTRAINT "task_min_tier_range_check" CHECK ("task"."min_tier" BETWEEN 0 AND 2),
	CONSTRAINT "task_completed_at_matches_status_check" CHECK (("task"."status" = 'done') = ("task"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"task_id" uuid,
	"parent_id" uuid,
	"author" uuid,
	"body" text DEFAULT '' NOT NULL,
	"file_key" text,
	"file_name" text,
	"file_size_bytes" bigint,
	"file_mime" text,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "message_has_content_check" CHECK ("message"."body" <> '' OR "message"."file_key" IS NOT NULL),
	CONSTRAINT "message_file_all_or_nothing_check" CHECK (num_nulls("message"."file_key", "message"."file_name", "message"."file_size_bytes", "message"."file_mime") IN (0, 4)),
	CONSTRAINT "message_file_size_positive_check" CHECK ("message"."file_size_bytes" IS NULL OR "message"."file_size_bytes" > 0),
	CONSTRAINT "message_not_own_parent_check" CHECK ("message"."parent_id" IS NULL OR "message"."parent_id" <> "message"."id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"budget_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton_check" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_budget_non_negative_check" CHECK ("settings"."budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_check" CHECK ("notification"."kind" IN ('task_assigned', 'task_due', 'mention', 'expense_decided', 'invite_accepted', 'event_created')),
	CONSTRAINT "notification_entity_all_or_nothing_check" CHECK (num_nulls("notification"."entity_type", "notification"."entity_id") IN (0, 2))
);
--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chan_member" ADD CONSTRAINT "chan_member_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chan_member" ADD CONSTRAINT "chan_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_submitter_app_user_id_fk" FOREIGN KEY ("submitter") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_decider_app_user_id_fk" FOREIGN KEY ("decider") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_lead_app_user_id_fk" FOREIGN KEY ("lead") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_lead_app_user_id_fk" FOREIGN KEY ("lead") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_app_user_id_fk" FOREIGN KEY ("assignee") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_creator_app_user_id_fk" FOREIGN KEY ("creator") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_within_declared_workstream" FOREIGN KEY ("event_id","team_id") REFERENCES "public"."workstream"("event_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_parent_id_message_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_app_user_id_fk" FOREIGN KEY ("author") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chan_member_user_idx" ON "chan_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_one_per_team" ON "channel" USING btree ("team_id") WHERE "channel"."kind" = 'team';--> statement-breakpoint
CREATE INDEX "event_starts_at_idx" ON "event" USING btree ("starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_pending_idx" ON "expense" USING btree ("created_at") WHERE "expense"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invite_email_idx" ON "invite" USING btree ("email");--> statement-breakpoint
CREATE INDEX "task_board_idx" ON "task" USING btree ("event_id","status","board_order");--> statement-breakpoint
CREATE INDEX "task_assignee_open_idx" ON "task" USING btree ("assignee","due_at") WHERE "task"."status" <> 'done';--> statement-breakpoint
CREATE INDEX "task_overdue_idx" ON "task" USING btree ("due_at") WHERE "task"."status" <> 'done' AND "task"."due_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_channel_idx" ON "message" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_task_idx" ON "message" USING btree ("task_id","created_at") WHERE "message"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_parent_idx" ON "message" USING btree ("parent_id") WHERE "message"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_feed_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" IS NULL;