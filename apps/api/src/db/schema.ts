import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Enums and tables mirror docs/IMPLEMENTATION_PLAN.md §5.2 (ERD) and §6
// (invariants) exactly — every CHECK/index/FK here is cited there.

export const userRoleEnum = pgEnum("user_role", ["PASSENGER", "DRIVER"]);
export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "SUSPENDED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "TESLAPAY"]);
export const rideStatusEnum = pgEnum("ride_status", [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
]);
export const poolStatusEnum = pgEnum("pool_status", [
  "OPEN",
  "DRIVER_ARRIVED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
]);

// Reference data: the 10-zone grid (§7.1) — rows inserted by a migration, not the app seed.
export const zones = pgTable("zones", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  xDkm: integer("x_dkm").notNull(),
  yDkm: integer("y_dkm").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    capacity: smallint("capacity").notNull(),
    isOnline: boolean("is_online").notNull().default(false),
    currentZone: text("current_zone").references(() => zones.code, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vehicles_driver_id_unique").on(table.driverId),
    check("vehicles_capacity_range", sql`${table.capacity} BETWEEN 1 AND 6`),
    check(
      "vehicles_online_requires_zone",
      sql`(NOT ${table.isOnline}) OR ${table.currentZone} IS NOT NULL`,
    ),
  ],
);

export const rideRequests = pgTable(
  "ride_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pickupZone: text("pickup_zone")
      .notNull()
      .references(() => zones.code, { onDelete: "restrict" }),
    dropoffZone: text("dropoff_zone")
      .notNull()
      .references(() => zones.code, { onDelete: "restrict" }),
    seats: smallint("seats").notNull(),
    distanceDkm: integer("distance_dkm").notNull(),
    soloFarePaisa: integer("solo_fare_paisa").notNull(),
    pooledFarePaisa: integer("pooled_fare_paisa").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    status: rideStatusEnum("status").notNull().default("REQUESTED"),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ride_requests_active_per_passenger")
      .on(table.passengerId)
      .where(sql`${table.status} IN ('REQUESTED','MATCHED','DRIVER_ARRIVED','STARTED')`),
    index("ride_requests_passenger_history").on(
      table.passengerId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("ride_requests_pickup_open")
      .on(table.pickupZone, table.createdAt)
      .where(sql`${table.status} = 'REQUESTED'`),
    check("ride_requests_seats_range", sql`${table.seats} BETWEEN 1 AND 6`),
    check("ride_requests_distance_positive", sql`${table.distanceDkm} > 0`),
    check("ride_requests_solo_fare_nonneg", sql`${table.soloFarePaisa} >= 0`),
    check(
      "ride_requests_pooled_fare_range",
      sql`${table.pooledFarePaisa} BETWEEN 0 AND ${table.soloFarePaisa}`,
    ),
    check("ride_requests_pickup_ne_dropoff", sql`${table.pickupZone} <> ${table.dropoffZone}`),
  ],
);

export const pools = pgTable(
  "pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pickupZone: text("pickup_zone")
      .notNull()
      .references(() => zones.code, { onDelete: "restrict" }),
    status: poolStatusEnum("status").notNull().default("OPEN"),
    capacitySnapshot: smallint("capacity_snapshot").notNull(),
    seatsReserved: smallint("seats_reserved").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pools_active_per_vehicle")
      .on(table.vehicleId)
      .where(sql`${table.status} IN ('OPEN','DRIVER_ARRIVED','STARTED')`),
    index("pools_open_by_pickup_zone")
      .on(table.pickupZone)
      .where(sql`${table.status} = 'OPEN'`),
    index("pools_driver_history").on(table.driverId, table.createdAt.desc(), table.id.desc()),
    check("pools_capacity_positive", sql`${table.capacitySnapshot} > 0`),
    check(
      "pools_seats_within_capacity",
      sql`${table.seatsReserved} BETWEEN 0 AND ${table.capacitySnapshot}`,
    ),
  ],
);

export const poolMemberships = pgTable(
  "pool_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poolId: uuid("pool_id")
      .notNull()
      .references(() => pools.id, { onDelete: "restrict" }),
    rideRequestId: uuid("ride_request_id")
      .notNull()
      .references(() => rideRequests.id, { onDelete: "restrict" }),
    seats: smallint("seats").notNull(),
    finalFarePaisa: integer("final_fare_paisa"),
    sharedRide: boolean("shared_ride"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    droppedOffAt: timestamp("dropped_off_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pool_memberships_ride_request_unique").on(table.rideRequestId),
    index("pool_memberships_active_by_pool")
      .on(table.poolId)
      .where(sql`${table.releasedAt} IS NULL`),
    check("pool_memberships_seats_positive", sql`${table.seats} > 0`),
    check(
      "pool_memberships_final_fare_nonneg",
      sql`${table.finalFarePaisa} IS NULL OR ${table.finalFarePaisa} >= 0`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseStatus: smallint("response_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    index("idempotency_keys_created_at").on(table.createdAt),
    check("idempotency_keys_key_length", sql`char_length(${table.key}) <= 64`),
  ],
);
