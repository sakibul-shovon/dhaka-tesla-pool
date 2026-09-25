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
