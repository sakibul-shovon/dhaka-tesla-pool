CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'TESLAPAY');--> statement-breakpoint
CREATE TYPE "public"."pool_status" AS ENUM('OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pool_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"ride_request_id" uuid NOT NULL,
	"seats" smallint NOT NULL,
	"final_fare_paisa" integer,
	"shared_ride" boolean,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"dropped_off_at" timestamp with time zone,
	CONSTRAINT "pool_memberships_seats_positive" CHECK ("pool_memberships"."seats" > 0),
	CONSTRAINT "pool_memberships_final_fare_nonneg" CHECK ("pool_memberships"."final_fare_paisa" IS NULL OR "pool_memberships"."final_fare_paisa" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"pickup_zone" text NOT NULL,
	"status" "pool_status" DEFAULT 'OPEN' NOT NULL,
	"capacity_snapshot" smallint NOT NULL,
	"seats_reserved" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "pools_capacity_positive" CHECK ("pools"."capacity_snapshot" > 0),
	CONSTRAINT "pools_seats_within_capacity" CHECK ("pools"."seats_reserved" BETWEEN 0 AND "pools"."capacity_snapshot")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"pickup_zone" text NOT NULL,
	"dropoff_zone" text NOT NULL,
	"seats" smallint NOT NULL,
	"distance_dkm" integer NOT NULL,
	"solo_fare_paisa" integer NOT NULL,
	"pooled_fare_paisa" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "ride_status" DEFAULT 'REQUESTED' NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "ride_requests_seats_range" CHECK ("ride_requests"."seats" BETWEEN 1 AND 6),
	CONSTRAINT "ride_requests_distance_positive" CHECK ("ride_requests"."distance_dkm" > 0),
	CONSTRAINT "ride_requests_solo_fare_nonneg" CHECK ("ride_requests"."solo_fare_paisa" >= 0),
	CONSTRAINT "ride_requests_pooled_fare_range" CHECK ("ride_requests"."pooled_fare_paisa" BETWEEN 0 AND "ride_requests"."solo_fare_paisa"),
	CONSTRAINT "ride_requests_pickup_ne_dropoff" CHECK ("ride_requests"."pickup_zone" <> "ride_requests"."dropoff_zone")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pool_memberships" ADD CONSTRAINT "pool_memberships_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pools" ADD CONSTRAINT "pools_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pools" ADD CONSTRAINT "pools_pickup_zone_zones_code_fk" FOREIGN KEY ("pickup_zone") REFERENCES "public"."zones"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_zone_zones_code_fk" FOREIGN KEY ("pickup_zone") REFERENCES "public"."zones"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_dropoff_zone_zones_code_fk" FOREIGN KEY ("dropoff_zone") REFERENCES "public"."zones"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pool_memberships_ride_request_unique" ON "pool_memberships" USING btree ("ride_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pool_memberships_active_by_pool" ON "pool_memberships" USING btree ("pool_id") WHERE "pool_memberships"."released_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pools_active_per_vehicle" ON "pools" USING btree ("vehicle_id") WHERE "pools"."status" IN ('OPEN','DRIVER_ARRIVED','STARTED');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pools_open_by_pickup_zone" ON "pools" USING btree ("pickup_zone") WHERE "pools"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pools_driver_history" ON "pools" USING btree ("driver_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ride_requests_active_per_passenger" ON "ride_requests" USING btree ("passenger_id") WHERE "ride_requests"."status" IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','STARTED');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ride_requests_passenger_history" ON "ride_requests" USING btree ("passenger_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ride_requests_pickup_open" ON "ride_requests" USING btree ("pickup_zone","created_at") WHERE "ride_requests"."status" = 'REQUESTED';