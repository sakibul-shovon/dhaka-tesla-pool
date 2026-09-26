import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(role: "DRIVER" | "PASSENGER" = "PASSENGER"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`Test ${role}`, `${randomUUID()}@dhakateslapool.test`, role],
  );
  return rows[0]!.id;
}

async function insertVehicle(driverId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone)
     VALUES ($1, 'Bullet', 3, false, 'BANANI') RETURNING id`,
    [driverId],
  );
  return rows[0]!.id;
}

async function insertRideRequest(passengerId: string, status = "REQUESTED"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method, status)
     VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 6750, 5400, 'CASH', $2) RETURNING id`,
    [passengerId, status],
  );
  return rows[0]!.id;
}

async function insertPool(vehicleId: string, driverId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved)
     VALUES ($1, $2, 'BANANI', 3, 0) RETURNING id`,
    [vehicleId, driverId],
  );
  return rows[0]!.id;
}

describe("vehicles constraints", () => {
  it("rejects capacity outside 1..6", async () => {
    const driverId = await insertUser("DRIVER");
    await expect(
      pool.query(
        `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', 7, false, 'BANANI')`,
        [driverId],
      ),
    ).rejects.toThrow(/vehicles_capacity_range/);
  });

  it("rejects an online vehicle with no current zone", async () => {
    const driverId = await insertUser("DRIVER");
    await expect(
      pool.query(
        `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Bullet', 3, true, NULL)`,
        [driverId],
      ),
    ).rejects.toThrow(/vehicles_online_requires_zone/);
  });

  it("rejects a second vehicle for the same driver", async () => {
    const driverId = await insertUser("DRIVER");
    await insertVehicle(driverId);
    await expect(
      pool.query(
        `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, 'Toofan', 3, false, 'BANANI')`,
        [driverId],
      ),
    ).rejects.toThrow(/vehicles_driver_id_unique/);
  });
});

describe("ride_requests constraints", () => {
  it("rejects seats outside 1..6", async () => {
    const passengerId = await insertUser();
    await expect(
      pool.query(
        `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
         VALUES ($1, 'BANANI', 'MOHAKHALI', 0, 25, 6750, 5400, 'CASH')`,
        [passengerId],
      ),
    ).rejects.toThrow(/ride_requests_seats_range/);
  });

  it("rejects pickup equal to dropoff", async () => {
    const passengerId = await insertUser();
    await expect(
      pool.query(
        `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
         VALUES ($1, 'BANANI', 'BANANI', 1, 25, 6750, 5400, 'CASH')`,
        [passengerId],
      ),
    ).rejects.toThrow(/ride_requests_pickup_ne_dropoff/);
  });

  it("rejects a pooled fare above the solo fare", async () => {
    const passengerId = await insertUser();
    await expect(
      pool.query(
        `INSERT INTO ride_requests (passenger_id, pickup_zone, dropoff_zone, seats, distance_dkm, solo_fare_paisa, pooled_fare_paisa, payment_method)
         VALUES ($1, 'BANANI', 'MOHAKHALI', 1, 25, 5000, 6000, 'CASH')`,
        [passengerId],
      ),
    ).rejects.toThrow(/ride_requests_pooled_fare_range/);
  });

  it("rejects a second active request for the same passenger", async () => {
    const passengerId = await insertUser();
    await insertRideRequest(passengerId, "MATCHED");
    await expect(insertRideRequest(passengerId, "REQUESTED")).rejects.toThrow(
      /ride_requests_active_per_passenger/,
    );
  });

  it("allows a second request once the first is no longer active", async () => {
    const passengerId = await insertUser();
    await insertRideRequest(passengerId, "COMPLETED");
    await expect(insertRideRequest(passengerId, "REQUESTED")).resolves.toBeDefined();
  });
});

describe("pools constraints", () => {
  it("rejects seats_reserved above capacity_snapshot", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    await expect(
      pool.query(
        `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, capacity_snapshot, seats_reserved) VALUES ($1, $2, 'BANANI', 3, 4)`,
        [vehicleId, driverId],
      ),
    ).rejects.toThrow(/pools_seats_within_capacity/);
  });

  it("rejects a second active pool for the same vehicle", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    await insertPool(vehicleId, driverId);
    await expect(insertPool(vehicleId, driverId)).rejects.toThrow(/pools_active_per_vehicle/);
  });
});

describe("pool_memberships constraints", () => {
  it("rejects the same ride request seated in two memberships", async () => {
    const passengerId = await insertUser();
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    const rideRequestId = await insertRideRequest(passengerId, "MATCHED");
    const poolAId = await insertPool(vehicleId, driverId);

    await pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, 1)`, [
      poolAId,
      rideRequestId,
    ]);

    await expect(
      pool.query(`INSERT INTO pool_memberships (pool_id, ride_request_id, seats) VALUES ($1, $2, 1)`, [
        poolAId,
        rideRequestId,
      ]),
    ).rejects.toThrow(/pool_memberships_ride_request_unique/);
  });
});

describe("wallet_transactions constraints (plan §8.4)", () => {
  it("prevents a double debit for the same ride request", async () => {
    const passengerId = await insertUser();
    const rideRequestId = await insertRideRequest(passengerId, "COMPLETED");
    await pool.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, 100000)`, [passengerId]);

    await pool.query(
      `INSERT INTO wallet_transactions (wallet_user_id, type, amount_paisa, ride_request_id) VALUES ($1, 'DEBIT', 6750, $2)`,
      [passengerId, rideRequestId],
    );

    await expect(
      pool.query(
        `INSERT INTO wallet_transactions (wallet_user_id, type, amount_paisa, ride_request_id) VALUES ($1, 'DEBIT', 6750, $2)`,
        [passengerId, rideRequestId],
      ),
    ).rejects.toThrow(/wallet_transactions_ride_request_type_unique/);
  });

  it("still allows any number of top-ups (NULL ride_request_id never collides)", async () => {
    const passengerId = await insertUser();
    await pool.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [passengerId]);

    await pool.query(`INSERT INTO wallet_transactions (wallet_user_id, type, amount_paisa) VALUES ($1, 'TOPUP', 50000)`, [
      passengerId,
    ]);
    await expect(
      pool.query(`INSERT INTO wallet_transactions (wallet_user_id, type, amount_paisa) VALUES ($1, 'TOPUP', 30000)`, [
        passengerId,
      ]),
    ).resolves.not.toThrow();
  });

  it("rejects a negative wallet balance", async () => {
    const passengerId = await insertUser();
    await pool.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, 100)`, [passengerId]);

    await expect(
      pool.query(`UPDATE wallets SET balance_paisa = -1 WHERE user_id = $1`, [passengerId]),
    ).rejects.toThrow(/wallets_balance_nonneg/);
  });
});

describe("idempotency_keys constraints", () => {
  it("rejects a key longer than 64 characters", async () => {
    const userId = await insertUser();
    await expect(
      pool.query(
        `INSERT INTO idempotency_keys (user_id, key, operation, request_fingerprint, response_status)
         VALUES ($1, $2, 'createRideRequest', 'fp', 201)`,
        [userId, "x".repeat(65)],
      ),
    ).rejects.toThrow(/idempotency_keys_key_length/);
  });
});

describe("history immutability trigger", () => {
  it("rejects UPDATE and DELETE on ride_status_history", async () => {
    const passengerId = await insertUser();
    const rideRequestId = await insertRideRequest(passengerId);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ride_status_history (ride_request_id, to_status) VALUES ($1, 'REQUESTED') RETURNING id`,
      [rideRequestId],
    );
    const historyId = rows[0]!.id;

    await expect(
      pool.query(`UPDATE ride_status_history SET reason = 'edited' WHERE id = $1`, [historyId]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM ride_status_history WHERE id = $1`, [historyId])).rejects.toThrow(
      /append-only/,
    );
  });

  it("rejects UPDATE and DELETE on pool_status_history", async () => {
    const driverId = await insertUser("DRIVER");
    const vehicleId = await insertVehicle(driverId);
    const poolId = await insertPool(vehicleId, driverId);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO pool_status_history (pool_id, to_status) VALUES ($1, 'OPEN') RETURNING id`,
      [poolId],
    );
    const historyId = rows[0]!.id;

    await expect(
      pool.query(`UPDATE pool_status_history SET reason = 'edited' WHERE id = $1`, [historyId]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM pool_status_history WHERE id = $1`, [historyId])).rejects.toThrow(
      /append-only/,
    );
  });
});
