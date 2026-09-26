import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { users, vehicles } from "../../db/schema.js";

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
    .values({ name: input.name, email: input.email, passwordHash: input.passwordHash, role: "DRIVER" })
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
