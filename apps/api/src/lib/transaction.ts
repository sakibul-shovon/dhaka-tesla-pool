import { sql } from "drizzle-orm";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db, Tx } from "../db/client.js";
import { HttpError } from "../http/error-mapper.js";

const MAX_ATTEMPTS = 3;

// 40P01 deadlock_detected, 40001 serialization_failure — Postgres aborted one
// side of a cycle/conflict itself; restarting from scratch usually succeeds
// (plan §10.3). Never retried: business errors (HttpError, thrown by the
// callback itself) and anything else, including constraint violations, which
// individual call sites already map to their own specific HttpError.
const RETRYABLE_PG_CODES = new Set(["40P01", "40001"]);

// 55P03 lock_not_available (our own `lock_timeout`), 57014 query_canceled
// (our own `statement_timeout`) — the system is genuinely backed up; retrying
// the same transaction would just wait again. Fail fast and let the client
// decide whether to retry (plan §10.3).
const BUSY_PG_CODES = new Set(["55P03", "57014"]);

function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 20-100ms jittered backoff (plan §10.3) — enough spread that two
// transactions retrying the same deadlock don't immediately collide again.
function jitteredBackoffMs(): number {
  return 20 + Math.random() * 80;
}

function serviceBusyError(): HttpError {
  return new HttpError(503, ERROR_CODES.SERVICE_BUSY, "Busy right now — try again in a moment.", undefined, 1);
}

// The one entry point every write path uses (plan §10.3). Short lock and
// statement timeouts mean a stuck transaction fails fast instead of piling
// up waiters behind it; a bounded retry covers the two Postgres codes that
// mean "restart and you'll probably succeed" rather than "this request is
// wrong."
export async function runInTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        return fn(tx);
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }

      const code = pgErrorCode(err);
      if (code && BUSY_PG_CODES.has(code)) {
        throw serviceBusyError();
      }
      if (code && RETRYABLE_PG_CODES.has(code) && attempt < MAX_ATTEMPTS) {
        lastError = err;
        await sleep(jitteredBackoffMs());
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
