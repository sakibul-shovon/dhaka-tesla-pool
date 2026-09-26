import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Db } from "../../src/db/client.js";
import { createSession, SESSION_COOKIE_NAME } from "../../src/modules/auth/session-service.js";

// Sessions are minted directly against the DB (mirrors session-service.int.test.ts
// and ride-requests.int.test.ts) rather than through POST /auth/register +
// /auth/login: those endpoints share a module-level rate limiter across every
// app instance in this process, and per-test isolation would otherwise trip
// it well before the 15-minute window passes. None of the tests using this
// helper are exercising the auth flow itself.
export interface UserContext {
  userId: string;
  cookie: string;
}

async function insertUser(pool: Pool, role: "PASSENGER" | "DRIVER" | "ADMIN", name: string): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [name, `${randomUUID()}@dhakateslapool.test`, role],
  );
  return row!.id;
}

export async function passengerContext(pool: Pool, db: Db, name = "Nusrat"): Promise<UserContext> {
  const userId = await insertUser(pool, "PASSENGER", name);
  const { token } = await createSession(db, userId, 1);
  return { userId, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

export async function adminContext(pool: Pool, db: Db, name = "Admin"): Promise<UserContext> {
  const userId = await insertUser(pool, "ADMIN", name);
  const { token } = await createSession(db, userId, 1);
  return { userId, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

export interface DriverContext extends UserContext {
  vehicleId: string;
}

export async function driverContext(
  pool: Pool,
  db: Db,
  name = "Jashim",
  vehicle: { name: string; capacity: number; isOnline?: boolean; currentZone?: string | null } = {
    name: "Bullet",
    capacity: 3,
  },
): Promise<DriverContext> {
  const userId = await insertUser(pool, "DRIVER", name);
  const {
    rows: [vehicleRow],
  } = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, capacity, is_online, current_zone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, vehicle.name, vehicle.capacity, vehicle.isOnline ?? false, vehicle.currentZone ?? null],
  );
  const { token } = await createSession(db, userId, 1);
  return { userId, vehicleId: vehicleRow!.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}
