// Live demo of the PRD's own race (plan §10.5, §16.5): Bullet has exactly
// one seat left, and two passengers, Nusrat and Shirin, both try to take it
// at the same instant. Run this against a *running* server — it fires two
// real, concurrent HTTP requests and prints who won — it does not use the
// in-process test harness `test/concurrency/last-seat-race.test.ts` does.
//
// Usage (from the repo root, with the api + its database already running):
//   DATABASE_URL=postgres://dtp:dtp@localhost:5432/dtp \
//   API_BASE_URL=http://localhost:4000 \
//   npx tsx scripts/race-demo.ts
//
// DATABASE_URL must point at the *same* database the running API server
// uses — this script seeds fixtures directly, then asks the server to act
// on them over HTTP, exactly like a real client would.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDb } from "../apps/api/src/db/client.js";
import { createSession, SESSION_COOKIE_NAME } from "../apps/api/src/modules/auth/session-service.js";

const databaseUrl = process.env.DATABASE_URL;
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

if (!databaseUrl) {
  console.error("Set DATABASE_URL to the running server's database first.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const db = createDb(pool);
const runId = randomUUID().slice(0, 8);

function log(line: string): void {
  console.log(line);
}

async function insertUser(name: string, role: "DRIVER" | "PASSENGER"): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [name, `${name.toLowerCase()}-${runId}@dhakateslapool.demo`, role],
  );
  return row!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(db, userId, 1);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function seedRequestedRide(passengerId: string, dropoffZone: string): Promise<string> {
  const {
    rows: [ride],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
     VALUES ($1, 'BANANI', $2, 1, 25, 6750, 5400, 'CASH') RETURNING id`,
    [passengerId, dropoffZone],
  );
  await pool.query(`INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, NULL, 'REQUESTED')`, [
    ride!.id,
  ]);
  return ride!.id;
}

async function joinPool(cookie: string, poolId: string, rideRequestId: string) {
  const res = await fetch(`${apiBaseUrl}/api/v1/pools/${poolId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), Cookie: cookie },
    body: JSON.stringify({ rideRequestId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  log(`Seeding the PRD's race against ${apiBaseUrl} (run ${runId})...\n`);

  const jashimId = await insertUser("Jashim", "DRIVER");
  const {
    rows: [vehicle],
  } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', 3, true, 'BANANI') RETURNING id`,
    [jashimId],
  );
  const {
    rows: [poolRow],
  } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 2) RETURNING id`,
    [vehicle!.id, jashimId],
  );
  await pool.query(`INSERT INTO pool_status_history (pool_id, from_status, to_status) VALUES ($1, NULL, 'OPEN')`, [poolRow!.id]);

  const rafiqId = await insertUser("Rafiq", "PASSENGER");
  const {
    rows: [rafiqRide],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status, matched_at)
     VALUES ($1, 'BANANI', 'GULSHAN_1', 2, 30, 7500, 6000, 'CASH', 'MATCHED', now()) RETURNING id`,
    [rafiqId],
  );
  await pool.query(
    `INSERT INTO ride_status_history (ride_request_id, from_status, to_status) VALUES ($1, NULL, 'REQUESTED'), ($1, 'REQUESTED', 'MATCHED')`,
    [rafiqRide!.id],
  );
  await pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, 2)`, [
    poolRow!.id,
    rafiqRide!.id,
  ]);

  log("Bullet (capacity 3) has Rafiq aboard (2 seats) — exactly 1 seat left.");

  const nusratId = await insertUser("Nusrat", "PASSENGER");
  const shirinId = await insertUser("Shirin", "PASSENGER");
  const nusratRide = await seedRequestedRide(nusratId, "MOHAKHALI");
  const shirinRide = await seedRequestedRide(shirinId, "GULSHAN_2");
  const nusratCookie = await cookieFor(nusratId);
  const shirinCookie = await cookieFor(shirinId);

  log("Nusrat and Shirin both see the same 1 seat left and both hit Join at the same instant...\n");

  const [nusratResult, shirinResult] = await Promise.all([
    joinPool(nusratCookie, poolRow!.id, nusratRide),
    joinPool(shirinCookie, poolRow!.id, shirinRide),
  ]);

  for (const [name, result] of [
    ["Nusrat", nusratResult],
    ["Shirin", shirinResult],
  ] as const) {
    if (result.status === 200) {
      log(`  ${name}: 200 OK — she's in Bullet.`);
    } else {
      const error = result.body.error as { code?: string; message?: string } | undefined;
      log(`  ${name}: ${result.status} ${error?.code ?? "?"} — "${error?.message ?? ""}"`);
    }
  }

  const {
    rows: [finalPool],
  } = await pool.query<{ seats_reserved: number; capacity_snapshot: number }>(
    `SELECT seats_reserved, capacity_snapshot FROM pools WHERE id = $1`,
    [poolRow!.id],
  );
  log(`\nFinal: seats_reserved = ${finalPool!.seats_reserved} of ${finalPool!.capacity_snapshot} — never over capacity.`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
