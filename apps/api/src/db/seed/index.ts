import "../../lib/load-env.js";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../client.js";
import { users, vehicles } from "../schema.js";

// The story cast (plan §0.1) — used verbatim everywhere, never user1/driver1.
const PASSENGERS = [
  { name: "Nusrat", email: "nusrat@dhakateslapool.test" },
  { name: "Rafiq", email: "rafiq@dhakateslapool.test" },
  { name: "Shirin", email: "shirin@dhakateslapool.test" },
] as const;
const DRIVER = { name: "Jashim", email: "jashim@dhakateslapool.test" } as const;
const VEHICLE = { name: "Bullet", capacity: 3, zone: "BANANI" } as const;

async function upsertUser(
  db: Db,
  email: string,
  name: string,
  role: "DRIVER" | "PASSENGER",
  passwordHash: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  if (existing) {
    await db.update(users).set({ name, passwordHash, role, updatedAt: new Date() }).where(eq(users.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db.insert(users).values({ email, name, passwordHash, role }).returning({ id: users.id });
  return inserted!.id;
}

// Idempotent on purpose: the compose `migrate` service may run this more
// than once against the same database.
export async function runSeed(databaseUrl: string, demoPassword: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb(pool);
  try {
    const passwordHash = await hash(demoPassword);

    const driverId = await upsertUser(db, DRIVER.email, DRIVER.name, "DRIVER", passwordHash);
    for (const passenger of PASSENGERS) {
      await upsertUser(db, passenger.email, passenger.name, "PASSENGER", passwordHash);
    }

    await db
      .insert(vehicles)
      .values({
        driverId,
        name: VEHICLE.name,
        capacity: VEHICLE.capacity,
        isOnline: false,
        currentZone: VEHICLE.zone,
      })
      .onConflictDoUpdate({
        target: vehicles.driverId,
        set: { name: VEHICLE.name, capacity: VEHICLE.capacity, currentZone: VEHICLE.zone },
      });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Refusing to seed demo data in production without ALLOW_DEMO_SEED=true.");
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!databaseUrl || !demoPassword) {
    console.error("DATABASE_URL and DEMO_PASSWORD are required to seed demo users.");
    process.exit(1);
  }
  runSeed(databaseUrl, demoPassword)
    .then(() => {
      console.log("seed complete: Jashim/Bullet, Nusrat, Rafiq, Shirin");
    })
    .catch((err: unknown) => {
      console.error("seed failed:", err);
      process.exit(1);
    });
}
