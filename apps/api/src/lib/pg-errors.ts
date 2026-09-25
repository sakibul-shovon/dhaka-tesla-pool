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
