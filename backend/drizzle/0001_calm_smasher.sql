ALTER TABLE "event" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "attendance_estimate" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "owner" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_owner_app_user_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workstream_team_idx" ON "workstream" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "task_team_due_idx" ON "task" USING btree ("team_id","due_at");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_attendance_estimate_non_negative_check" CHECK ("event"."attendance_estimate" IS NULL OR "event"."attendance_estimate" >= 0);