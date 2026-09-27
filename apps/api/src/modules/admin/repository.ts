import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import { accountStatusHistory, users, vehicles } from "../../db/schema.js";
import type { AccountStatus } from "../../domain/account-state-machine.js";

export interface DriverSummary {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  vehicleId: string;
  vehicleName: string;
  capacity: number;
  isOnline: boolean;
  currentZone: string | null;
}

const DRIVER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  status: users.status,
  createdAt: users.createdAt,
  vehicleId: vehicles.id,
  vehicleName: vehicles.name,
  capacity: vehicles.capacity,
  isOnline: vehicles.isOnline,
  currentZone: vehicles.currentZone,
} as const;

export async function listDrivers(db: Db): Promise<DriverSummary[]> {
  return db
    .select(DRIVER_COLUMNS)
    .from(users)
    .innerJoin(vehicles, eq(vehicles.driverId, users.id))
    .where(eq(users.role, "DRIVER"))
    .orderBy(desc(users.createdAt));
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: AccountStatus;
  createdAt: Date;
}

// Explicit allow-list — `password_hash` is never selected (plan §13.1 API8).
const ACCOUNT_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
} as const;

// The write path (suspend/reactivate) goes through lockUserById +
// applyAccountTransition instead, never through a plain repository update
// (plan §10.7) — everything below this line is read-only (ADR-019).
export async function findAccountById(db: Db | Tx, id: string): Promise<AccountRow | undefined> {
  const [row] = await db.select(ACCOUNT_COLUMNS).from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export interface ListAccountsParams {
  role?: "PASSENGER" | "DRIVER" | "ADMIN";
  status?: AccountStatus;
  q?: string;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

// `limit + 1` rows fetched so the route can tell "there is a next page"
// without a separate COUNT (plan §12.1 keyset pagination, same as every
// other list endpoint).
export async function listAccounts(db: Db, params: ListAccountsParams): Promise<AccountRow[]> {
  const conditions = [];
  if (params.role) {
    conditions.push(eq(users.role, params.role));
  }
  if (params.status) {
    conditions.push(eq(users.status, params.status));
  }
  if (params.q) {
    const pattern = `%${params.q}%`;
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
  }
  if (params.cursor) {
    conditions.push(
      or(
        lt(users.createdAt, params.cursor.createdAt),
        and(eq(users.createdAt, params.cursor.createdAt), lt(users.id, params.cursor.id))!,
      )!,
    );
  }

  return db
    .select(ACCOUNT_COLUMNS)
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(params.limit + 1);
}

export interface AccountStatusHistoryRow {
  id: number;
  fromStatus: AccountStatus;
  toStatus: AccountStatus;
  actorUserId: string;
  reason: string | null;
  createdAt: Date;
}

export async function listAccountStatusHistory(
  db: Db,
  userId: string,
): Promise<AccountStatusHistoryRow[]> {
  return db
    .select({
      id: accountStatusHistory.id,
      fromStatus: accountStatusHistory.fromStatus,
      toStatus: accountStatusHistory.toStatus,
      actorUserId: accountStatusHistory.actorUserId,
      reason: accountStatusHistory.reason,
      createdAt: accountStatusHistory.createdAt,
    })
    .from(accountStatusHistory)
    .where(eq(accountStatusHistory.userId, userId))
    .orderBy(desc(accountStatusHistory.createdAt), desc(accountStatusHistory.id));
}

export function toAccountStatusHistoryDTO(row: AccountStatusHistoryRow) {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorUserId: row.actorUserId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface NewDriver {
  name: string;
  email: string;
  passwordHash: string;
  vehicleName: string;
  capacity: number;
  zone?: string | undefined;
}

// No explicit transaction: a fresh user id can't yet be referenced by any
// concurrent write, so there's no lock-order concern here (unlike the
// domain-writes paths) — mirrors the seed script's own user-then-vehicle
// sequencing.
export async function createDriverWithVehicle(db: Db, input: NewDriver): Promise<DriverSummary> {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: "DRIVER",
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      createdAt: users.createdAt,
    });

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      driverId: user!.id,
      name: input.vehicleName,
      capacity: input.capacity,
      currentZone: input.zone ?? null,
    })
    .returning({
      id: vehicles.id,
      name: vehicles.name,
      capacity: vehicles.capacity,
      isOnline: vehicles.isOnline,
      currentZone: vehicles.currentZone,
    });

  return {
    id: user!.id,
    name: user!.name,
    email: user!.email,
    status: user!.status,
    createdAt: user!.createdAt,
    vehicleId: vehicle!.id,
    vehicleName: vehicle!.name,
    capacity: vehicle!.capacity,
    isOnline: vehicle!.isOnline,
    currentZone: vehicle!.currentZone,
  };
}
