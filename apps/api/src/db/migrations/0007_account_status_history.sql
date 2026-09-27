CREATE TABLE IF NOT EXISTS "account_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"from_status" "account_status" NOT NULL,
	"to_status" "account_status" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_status_history_changes" CHECK ("account_status_history"."from_status" <> "account_status_history"."to_status")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_status_history" ADD CONSTRAINT "account_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_status_history" ADD CONSTRAINT "account_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_status_history_timeline" ON "account_status_history" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ride_requests_created" ON "ride_requests" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);