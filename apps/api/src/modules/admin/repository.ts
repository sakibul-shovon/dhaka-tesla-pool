import { and, asc, count, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import type { Db, Tx } from "../../db/client.js";
import {
  accountStatusHistory,
  pools,
  rideRequests,
  users,
  vehicles,
  zones,
} from "../../db/schema.js";
import type { AccountStatus } from "../../domain/account-state-machine.js";
import { ACTIVE_RIDE_STATUSES } from "../../domain/ride-state-machine.js";
import { ACTIVE_POOL_STATUSES } from "../../domain/pool-state-machine.js";

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
  return (
    db
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
      // Oldest first, matching listRideStatusHistory/listPoolStatusHistory —
      // the shared Timeline component reads its entries top-to-bottom as a
      // chronological story, not newest-first.
      .orderBy(asc(accountStatusHistory.createdAt), asc(accountStatusHistory.id))
  );
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

export interface AdminStats {
  totals: {
    totalRides: number;
    activeRides: number;
    completedRides: number;
    cancelledRides: number;
    onlineDrivers: number;
    activePools: number;
  };
  byZone: {
    zoneCode: string;
    zoneName: string;
    onlineDrivers: number;
    openRequests: number;
    activePools: number;
  }[];
}

// Read-only counts for the admin overview (ADR-019): what actually exists
// (zone, online/offline, request/pool status), never anything geolocated —
// there's no coordinate finer than a zone anywhere in this system (plan §4).
export async function getAdminStats(db: Db): Promise<AdminStats> {
  const onlineDriverFilter = and(eq(vehicles.isOnline, true), eq(users.status, "ACTIVE"));

  const [
    totalRidesRow,
    activeRidesRow,
    completedRidesRow,
    cancelledRidesRow,
    onlineDriversRow,
    activePoolsRow,
    zoneRows,
    onlineDriversByZone,
    openRequestsByZone,
    activePoolsByZone,
  ] = await Promise.all([
    db.select({ n: count() }).from(rideRequests),
    db
      .select({ n: count() })
      .from(rideRequests)
      .where(inArray(rideRequests.status, [...ACTIVE_RIDE_STATUSES])),
    db.select({ n: count() }).from(rideRequests).where(eq(rideRequests.status, "COMPLETED")),
    db.select({ n: count() }).from(rideRequests).where(eq(rideRequests.status, "CANCELLED")),
    db
      .select({ n: count() })
      .from(vehicles)
      .innerJoin(users, eq(users.id, vehicles.driverId))
      .where(onlineDriverFilter),
    db
      .select({ n: count() })
      .from(pools)
      .where(inArray(pools.status, [...ACTIVE_POOL_STATUSES])),
    db.select({ code: zones.code, name: zones.name }).from(zones),
    db
      .select({ zone: vehicles.currentZone, n: count() })
      .from(vehicles)
      .innerJoin(users, eq(users.id, vehicles.driverId))
      .where(onlineDriverFilter)
      .groupBy(vehicles.currentZone),
    db
      .select({ zone: rideRequests.pickupZone, n: count() })
      .from(rideRequests)
      .where(eq(rideRequests.status, "REQUESTED"))
      .groupBy(rideRequests.pickupZone),
    db
      .select({ zone: pools.pickupZone, n: count() })
      .from(pools)
      .where(inArray(pools.status, [...ACTIVE_POOL_STATUSES]))
      .groupBy(pools.pickupZone),
  ]);

  const onlineByZone = new Map(onlineDriversByZone.map((row) => [row.zone, row.n]));
  const openRequestsByZoneMap = new Map(openRequestsByZone.map((row) => [row.zone, row.n]));
  const activePoolsByZoneMap = new Map(activePoolsByZone.map((row) => [row.zone, row.n]));

  return {
    totals: {
      totalRides: totalRidesRow[0]?.n ?? 0,
      activeRides: activeRidesRow[0]?.n ?? 0,
      completedRides: completedRidesRow[0]?.n ?? 0,
      cancelledRides: cancelledRidesRow[0]?.n ?? 0,
      onlineDrivers: onlineDriversRow[0]?.n ?? 0,
      activePools: activePoolsRow[0]?.n ?? 0,
    },
    byZone: zoneRows.map((zone) => ({
      zoneCode: zone.code,
      zoneName: zone.name,
      onlineDrivers: onlineByZone.get(zone.code) ?? 0,
      openRequests: openRequestsByZoneMap.get(zone.code) ?? 0,
      activePools: activePoolsByZoneMap.get(zone.code) ?? 0,
    })),
  };
}
