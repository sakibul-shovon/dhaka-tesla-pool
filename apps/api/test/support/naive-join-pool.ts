import type { Pool } from "pg";

export interface NaiveJoinInput {
  poolId: string;
  rideRequestId: string;
  seats: number;
}

export interface NaiveJoinResult {
  ok: boolean;
  errorCode?: string;
}

// Deliberately unsafe (plan §16.5): read seats -> sleep -> write, with no row
// lock and no atomic conditional update. Exists only as a control: it proves
// the concurrency harness itself can catch a real race. If the harness can't
// catch this, it can't be trusted to have caught anything in the real
// `reserveSeat` tests either.
export async function naiveJoinPool(pool: Pool, input: NaiveJoinInput): Promise<NaiveJoinResult> {
  const { rows } = await pool.query<{ seats_reserved: number; capacity_snapshot: number }>(
    `SELECT seats_reserved, capacity_snapshot FROM pools WHERE id = $1`,
    [input.poolId],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false };
  }

  await new Promise((resolve) => setTimeout(resolve, 50));

  if (row.seats_reserved + input.seats > row.capacity_snapshot) {
    return { ok: false };
  }

  try {
    await pool.query(`UPDATE pools SET seats_reserved = $2 WHERE id = $1`, [
      input.poolId,
      row.seats_reserved + input.seats,
    ]);
    await pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, $3)`, [
      input.poolId,
      input.rideRequestId,
      input.seats,
    ]);
    await pool.query(`UPDATE ride_requests SET status = 'MATCHED', matched_at = now() WHERE id = $1`, [
      input.rideRequestId,
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorCode: (err as { code?: string }).code };
  }
}
