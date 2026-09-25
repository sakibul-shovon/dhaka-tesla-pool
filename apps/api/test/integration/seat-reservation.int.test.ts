import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { createDb, type Db } from "../../src/db/client.js";
import { runInTransaction } from "../../src/lib/transaction.js";
import { reserveSeat } from "../../src/modules/pools/seat-reservation.js";
import { markLocked } from "../../src/domain-writes/locked.js";
import type { LockedOwnedPool } from "../../src/modules/pools/repository.js";
import type { LockedRideRequestForTransition } from "../../src/domain-writes/ride-transitions.js";

let pool: Pool;
let db: Db;

beforeAll(() => {
  pool = createTestPool();
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(role: "DRIVER" | "PASSENGER"): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [role, `${role}-${Math.random()}@dhakateslapool.test`, role],
  );
  return row!.id;
}

async function insertVehicle(driverId: string, capacity = 3): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', $2, true, 'BANANI') RETURNING id`,
    [driverId, capacity],
  );
  return row!.id;
}

async function insertPool(vehicleId: string, driverId: string, capacity = 3, seatsReserved = 0): Promise<LockedOwnedPool> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', $3, $4) RETURNING id`,
    [vehicleId, driverId, capacity, seatsReserved],
  );
  return markLocked({
    id: row!.id,
    vehicleId,
    driverId,
    pickupZone: "BANANI",
    status: "OPEN",
    capacitySnapshot: capacity,
    seatsReserved,
  });
}

async function insertRideRequest(
  passengerId: string,
  overrides: { dropoffZone?: string; seats?: number; status?: string } = {},
): Promise<LockedRideRequestForTransition & { pickupZone: string; dropoffZone: string; seats: number }> {
  const dropoffZone = overrides.dropoffZone ?? "MOHAKHALI";
  const seats = overrides.seats ?? 1;
  const status = overrides.status ?? "REQUESTED";
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
     VALUES ($1, 'BANANI', $2, $3, 25, 6750, 5400, 'CASH', $4) RETURNING id`,
    [passengerId, dropoffZone, seats, status],
  );
  return markLocked({ id: row!.id, status: status as never, pickupZone: "BANANI", dropoffZone, seats });
}

describe("reserveSeat", () => {
  it("reserves a seat, inserts a membership, and matches the request", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    const lockedPool = await insertPool(vehicleId, driverId);
    const passengerId = await insertUser("PASSENGER");
    const lockedRequest = await insertRideRequest(passengerId);

    await runInTransaction(db, (tx) =>
      reserveSeat(tx, { lockedPool, lockedRequest, members: [], command: "accept", actorUserId: driverId }),
    );

    const { rows: poolRows } = await pool.query<{ seats_reserved: number }>(
      `SELECT seats_reserved FROM pools WHERE id = $1`,
      [lockedPool.id],
    );
    expect(poolRows[0]!.seats_reserved).toBe(1);

    const { rows: requestRows } = await pool.query<{ status: string }>(
      `SELECT status FROM ride_requests WHERE id = $1`,
      [lockedRequest.id],
    );
    expect(requestRows[0]!.status).toBe("MATCHED");

    const { rows: membershipRows } = await pool.query(`SELECT * FROM pool_memberships WHERE pool_id = $1`, [
      lockedPool.id,
    ]);
    expect(membershipRows).toHaveLength(1);
  });

  it("rejects when the pool has no remaining capacity", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId, 1);
    const lockedPool = await insertPool(vehicleId, driverId, 1, 1); // already full
    const passengerId = await insertUser("PASSENGER");
    const lockedRequest = await insertRideRequest(passengerId);

    await expect(
      runInTransaction(db, (tx) =>
        reserveSeat(tx, { lockedPool, lockedRequest, members: [], command: "accept", actorUserId: driverId }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a drop-off too far from an existing member (>3.5km)", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    const lockedPool = await insertPool(vehicleId, driverId);
    const passengerId = await insertUser("PASSENGER");
    // Nusrat already aboard (Mohakhali); Shirin (Gulshan 2) is 4.5km away — incompatible.
    const shirin = await insertRideRequest(passengerId, { dropoffZone: "GULSHAN_2" });

    await expect(
      runInTransaction(db, (tx) =>
        reserveSeat(tx, {
          lockedPool,
          lockedRequest: shirin,
          members: [{ dropoffZone: "MOHAKHALI" }],
          command: "accept",
          actorUserId: driverId,
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a request that is no longer REQUESTED", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    const lockedPool = await insertPool(vehicleId, driverId);
    const passengerId = await insertUser("PASSENGER");
    const lockedRequest = await insertRideRequest(passengerId, { status: "CANCELLED" });

    await expect(
      runInTransaction(db, (tx) =>
        reserveSeat(tx, { lockedPool, lockedRequest, members: [], command: "accept", actorUserId: driverId }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
