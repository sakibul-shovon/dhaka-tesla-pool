CREATE TABLE IF NOT EXISTS "pool_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"from_status" "pool_status",
	"to_status" "pool_status" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ride_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ride_request_id" uuid NOT NULL,
	"from_status" "ride_status",
	"to_status" "ride_status" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pool_status_history" ADD CONSTRAINT "pool_status_history_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pool_status_history" ADD CONSTRAINT "pool_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_status_history" ADD CONSTRAINT "ride_status_history_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_status_history" ADD CONSTRAINT "ride_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pool_status_history_timeline" ON "pool_status_history" USING btree ("pool_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ride_status_history_timeline" ON "ride_status_history" USING btree ("ride_request_id","created_at","id");