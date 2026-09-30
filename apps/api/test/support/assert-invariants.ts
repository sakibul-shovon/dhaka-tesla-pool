import type { Pool } from "pg";

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

// Plan §16.4 — runs after every integration and concurrency test. Most of
// these are also backstopped by a DB CHECK/unique index (noted per check);
// this still asserts them at the app level so a violation shows up as a
// named, readable failure here rather than only as an opaque 23514/23505
// during the run that produced it.
export async function assertInvariants(pool: Pool): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  // I4: seats_reserved = sum of unreleased membership seats.
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

  // Also DB-enforced by the `pools_seats_within_capacity` CHECK.
  const overCapacity = await pool.query<{
    id: string;
    seats_reserved: number;
    capacity_snapshot: number;
  }>(`
    SELECT id, seats_reserved, capacity_snapshot FROM pools
    WHERE seats_reserved < 0 OR seats_reserved > capacity_snapshot
  `);
  for (const row of overCapacity.rows) {
    violations.push({
      invariant: "seats_reserved between 0 and capacity_snapshot",
      detail: `pool ${row.id}: seats_reserved=${row.seats_reserved} capacity=${row.capacity_snapshot}`,
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

  // The mirror image of the check above: a "ghost" membership left
  // unreleased after its own ride request was cancelled. This is exactly
  // the failure mode a race between accept/join and cancel produced before
  // the cancel handler re-verified its membership read under lock — I4
  // alone can't see it, since the pool's own bookkeeping stays internally
  // consistent (seats_reserved still matches the sum of unreleased seats;
  // it's just summing a membership that shouldn't still be unreleased).
  // COMPLETED is deliberately excluded: a normal drop-off sets
  // dropped_off_at but never released_at (plan §5.2 — released_at is
  // "cancel / no-show" only), so an unreleased-but-completed membership is
  // the expected, correct state, not a drift.
  const ghostMembership = await pool.query<{ id: string; ride_request_id: string }>(`
    SELECT m.id, m.ride_request_id
    FROM pool_memberships m
    JOIN ride_requests r ON r.id = m.ride_request_id
    WHERE m.released_at IS NULL AND r.status = 'CANCELLED'
  `);
  for (const row of ghostMembership.rows) {
    violations.push({
      invariant: "no unreleased membership points at a CANCELLED ride_request",
      detail: `membership ${row.id}: ride_request ${row.ride_request_id}`,
    });
  }

  // Also DB-enforced by `ride_requests_active_per_passenger`.
  const activeDuplicates = await pool.query<{ passenger_id: string; count: string }>(`
    SELECT passenger_id, COUNT(*) AS count
    FROM ride_requests
    WHERE status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED')
    GROUP BY passenger_id
    HAVING COUNT(*) > 1
  `);
  for (const row of activeDuplicates.rows) {
    violations.push({
      invariant: "at most one active ride request per passenger",
      detail: `passenger ${row.passenger_id}: ${row.count} active requests`,
    });
  }

  const seatsMismatch = await pool.query<{
    id: string;
    membership_seats: number;
    request_seats: number;
  }>(`
    SELECT m.id, m.seats AS membership_seats, r.seats AS request_seats
    FROM pool_memberships m
    JOIN ride_requests r ON r.id = m.ride_request_id
    WHERE m.seats <> r.seats
  `);
  for (const row of seatsMismatch.rows) {
    violations.push({
      invariant: "membership seats = its ride request's seats",
      detail: `membership ${row.id}: membership=${row.membership_seats} request=${row.request_seats}`,
    });
  }

  // I14 (plan §10.7): the latest history row's to_status is always the
  // aggregate's current status — a single write path (applyRideTransition /
  // applyPoolTransition) is what makes this provable rather than hopeful.
  const rideHistoryDrift = await pool.query<{
    id: string;
    status: string;
    last_to_status: string | null;
  }>(`
    SELECT r.id, r.status, h.to_status AS last_to_status
    FROM ride_requests r
    LEFT JOIN LATERAL (
      SELECT to_status FROM ride_status_history
      WHERE ride_request_id = r.id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) h ON true
    WHERE h.to_status IS DISTINCT FROM r.status
  `);
  for (const row of rideHistoryDrift.rows) {
    violations.push({
      invariant: "I14: ride_request's latest history row matches its current status",
      detail: `ride_request ${row.id}: status=${row.status} last_history=${row.last_to_status ?? "none"}`,
    });
  }

  const poolHistoryDrift = await pool.query<{
    id: string;
    status: string;
    last_to_status: string | null;
  }>(`
    SELECT p.id, p.status, h.to_status AS last_to_status
    FROM pools p
    LEFT JOIN LATERAL (
      SELECT to_status FROM pool_status_history
      WHERE pool_id = p.id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) h ON true
    WHERE h.to_status IS DISTINCT FROM p.status
  `);
  for (const row of poolHistoryDrift.rows) {
    violations.push({
      invariant: "I14: pool's latest history row matches its current status",
      detail: `pool ${row.id}: status=${row.status} last_history=${row.last_to_status ?? "none"}`,
    });
  }

  const rideTerminalTimestamps = await pool.query<{ id: string; status: string }>(`
    SELECT id, status FROM ride_requests
    WHERE (status = 'COMPLETED' AND completed_at IS NULL)
       OR (status = 'CANCELLED' AND cancelled_at IS NULL)
  `);
  for (const row of rideTerminalTimestamps.rows) {
    violations.push({
      invariant: "terminal ride_request has its terminal timestamp set",
      detail: `ride_request ${row.id}: status=${row.status}`,
    });
  }

  const poolTerminalTimestamps = await pool.query<{ id: string; status: string }>(`
    SELECT id, status FROM pools
    WHERE (status = 'COMPLETED' AND completed_at IS NULL)
       OR (status = 'CANCELLED' AND cancelled_at IS NULL)
  `);
  for (const row of poolTerminalTimestamps.rows) {
    violations.push({
      invariant: "terminal pool has its terminal timestamp set",
      detail: `pool ${row.id}: status=${row.status}`,
    });
  }

  // Also DB-enforced by `ride_requests_solo_fare_nonneg`, `_pooled_fare_range`
  // and `pool_memberships_final_fare_nonneg`.
  const negativeFares = await pool.query<{ id: string }>(`
    SELECT id FROM ride_requests WHERE solo_fare_paisa < 0 OR pooled_fare_paisa < 0
    UNION ALL
    SELECT id FROM pool_memberships WHERE final_fare_paisa IS NOT NULL AND final_fare_paisa < 0
  `);
  for (const row of negativeFares.rows) {
    violations.push({ invariant: "no negative fare", detail: `row ${row.id}` });
  }

  // ADR-019: suspension is refused while a driver has an active pool, and
  // accept re-checks is_online under the same vehicle lock suspension takes
  // -- so this combination should be unreachable regardless of which side
  // of that race wins.
  const suspendedDriverWithActivePool = await pool.query<{ user_id: string; pool_id: string }>(`
    SELECT u.id AS user_id, p.id AS pool_id
    FROM users u
    JOIN vehicles v ON v.driver_id = u.id
    JOIN pools p ON p.vehicle_id = v.id
    WHERE u.status = 'SUSPENDED' AND p.status IN ('OPEN', 'DRIVER_ARRIVED', 'STARTED')
  `);
  for (const row of suspendedDriverWithActivePool.rows) {
    violations.push({
      invariant: "no suspended driver holds an active pool (ADR-019)",
      detail: `driver ${row.user_id}: pool ${row.pool_id}`,
    });
  }

  return violations;
}
