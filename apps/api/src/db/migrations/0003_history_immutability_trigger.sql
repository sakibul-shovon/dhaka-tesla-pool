-- Invariant I13 (plan §6): history rows are append-only. Enforced at the
-- database level so it holds even if application code is wrong.
CREATE FUNCTION forbid_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'history rows are append-only and cannot be % (table %)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ride_status_history_immutable
  BEFORE UPDATE OR DELETE ON "ride_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
--> statement-breakpoint
CREATE TRIGGER pool_status_history_immutable
  BEFORE UPDATE OR DELETE ON "pool_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
