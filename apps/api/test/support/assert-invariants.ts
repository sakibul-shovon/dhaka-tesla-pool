import type { Pool } from "pg";

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

// Plan §16.4 — the full list grows as later sessions add the business logic
// that could actually drift these. Session 2 implements the two invariants
// that are meaningful with schema alone; this is deliberately a skeleton.
export async function assertInvariants(pool: Pool): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  const seatsDrift = await pool.query<{ id: string; seats_reserved: number; actual: string }>(`
    SELECT p.id, p.seats_reserved, COALESCE(SUM(m.seats), 0) AS actual
    FROM pools p
    LEFT JOIN pool_memberships m ON m.pool_id = p.id AND m.released_at IS NULL
    GROUP BY p.id, p.seats_reserved
    HAVING p.seats_reserved <> COALESCE(SUM(m.seats), 0)
  `);
  for (const row of seatsDrift.rows) {
    violations.push({
      invariant: "I4: seats_reserved = sum of unreleased membership seats",
      detail: `pool ${row.id}: seats_reserved=${row.seats_reserved} actual=${row.actual}`,
    });
  }

  const orphanMatched = await pool.query<{ id: string }>(`
    SELECT r.id
    FROM ride_requests r
    LEFT JOIN pool_memberships m ON m.ride_request_id = r.id AND m.released_at IS NULL
    WHERE r.status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED') AND m.id IS NULL
  `);
  for (const row of orphanMatched.rows) {
    violations.push({
      invariant: "no request in MATCHED+ without an unreleased membership",
      detail: `ride_request ${row.id}`,
    });
  }

  return violations;
}
