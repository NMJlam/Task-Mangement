CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" text NOT NULL,
	"tier" smallint GENERATED ALWAYS AS (CASE role
          WHEN 'president' THEN 2
          WHEN 'vice_president' THEN 2
          WHEN 'treasurer' THEN 2
          WHEN 'secretary' THEN 2
          WHEN 'marketing_director' THEN 1
          WHEN 'officer' THEN 0
        END) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_user_role_check" CHECK ("app_user"."role" IN ('president', 'vice_president', 'treasurer', 'secretary', 'marketing_director', 'officer'))
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invite_email_lowercase_check" CHECK ("invite"."email" = lower("invite"."email")),
	CONSTRAINT "invite_role_check" CHECK ("invite"."role" IN ('president', 'vice_president', 'treasurer', 'secretary', 'marketing_director', 'officer'))
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "public"."user_role";
