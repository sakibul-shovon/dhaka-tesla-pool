import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { users } from "../../db/schema.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
}

// Explicit column selection, not `select *` — a mass-assignment / accidental
// over-fetch defence (plan §13.1 API3): a new sensitive column added to
// `users` later doesn't silently start flowing through this repository.
const USER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  passwordHash: users.passwordHash,
  role: users.role,
  status: users.status,
} as const;

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const [row] = await db
    .select(USER_COLUMNS)
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select(USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export interface NewPassenger {
  name: string;
  email: string;
  passwordHash: string;
}

// Role is hard-coded to PASSENGER here, not accepted as a parameter — public
// registration can never create a driver (plan §13.1, ADR A3).
export async function createPassengerUser(db: Db, input: NewPassenger): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ name: input.name, email: input.email, passwordHash: input.passwordHash, role: "PASSENGER" })
    .returning(USER_COLUMNS);
  return row!;
}
