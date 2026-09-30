// Defence in depth (plan §11): the app checks a business rule before
// writing, but a constraint is the backstop if a race slips past that
// check. This recognises "which constraint" without leaking the raw
// Postgres error to the client.
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint?: string }).constraint === constraintName
  );
}

// Node socket errors and Postgres "server is going away / not ready" codes:
// the database can't be reached right now, which is not a bug in the request.
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (still starting up)
]);

// pg-pool has no error code for "no free connection within
// connectionTimeoutMillis"; the message is the only signal it gives.
const UNREACHABLE_MESSAGES = [
  "timeout exceeded when trying to connect",
  "Connection terminated",
  "Client has encountered a connection error",
];

// True when the error means "couldn't reach the database": a free-tier
// Postgres that is still waking up, a dropped connection, a restart. Follows
// `cause` in case a layer above pg wrapped the original error.
export function isDatabaseUnreachable(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && (UNREACHABLE_CODES.has(code) || code.startsWith("08"))) {
      return true;
    }
    if (typeof message === "string" && UNREACHABLE_MESSAGES.some((m) => message.includes(m))) {
      return true;
    }
    current = cause;
  }
  return false;
}
