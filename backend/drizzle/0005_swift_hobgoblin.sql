CREATE TABLE "task_assignee" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "task_assignee_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT "task_assignee_app_user_id_fk";
--> statement-breakpoint
DROP INDEX "task_assignee_open_idx";--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignee_user_idx" ON "task_assignee" USING btree ("user_id");--> statement-breakpoint
-- Data move, hand-written: every existing single assignee becomes one junction
-- row BEFORE the column it came from is dropped. Written by drizzle-kit as a
-- plain DROP COLUMN, which would have thrown the assignments away.
INSERT INTO "task_assignee" ("task_id", "user_id") SELECT "id", "assignee" FROM "task" WHERE "assignee" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "assignee";