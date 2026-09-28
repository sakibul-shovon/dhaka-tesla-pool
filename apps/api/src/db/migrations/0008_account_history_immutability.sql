-- Invariant I13 (plan §6), extended to account status history (ADR-019):
-- reuses the function 0003 created, so every history table fails the same way.
CREATE TRIGGER account_status_history_immutable
  BEFORE UPDATE OR DELETE ON "account_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
