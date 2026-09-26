import type pino from "pino";

// Named business events (plan §14) — always called after the transaction
// that caused them has committed, never from inside `runInTransaction`, so a
// rolled-back attempt never appears in the log as if it happened. Logged
// through the request's own child logger (`req.log`) so every event line
// already carries that request's id without repeating it here.
export function logBusinessEvent(logger: pino.Logger, event: string, data: Record<string, unknown> = {}): void {
  logger.info({ event, ...data }, event);
}
