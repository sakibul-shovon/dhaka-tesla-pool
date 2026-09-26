CREATE TYPE "public"."wallet_transaction_type" AS ENUM('TOPUP', 'DEBIT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_user_id" uuid NOT NULL,
	"type" "wallet_transaction_type" NOT NULL,
	"amount_paisa" integer NOT NULL,
	"ride_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_amount_positive" CHECK ("wallet_transactions"."amount_paisa" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance_paisa" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_nonneg" CHECK ("wallets"."balance_paisa" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_user_id_wallets_user_id_fk" FOREIGN KEY ("wallet_user_id") REFERENCES "public"."wallets"("user_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_ride_request_type_unique" ON "wallet_transactions" USING btree ("ride_request_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_transactions_by_wallet" ON "wallet_transactions" USING btree ("wallet_user_id","created_at" DESC NULLS LAST);