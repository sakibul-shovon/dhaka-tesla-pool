import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sessions, users } from "../../db/schema.js";

// Plan §13.3: 32 random bytes, only the SHA-256 hash is ever stored — a
// leaked database row can't be replayed as a session token.
export const SESSION_COOKIE_NAME = "dtp_session";
const TOKEN_BYTES = 32;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

// Rejects a session that is revoked, expired, or belongs to a suspended
// user — all three are "not authenticated", not distinguished to the caller
// (no oracle for which one it was).
export async function resolveSession(db: Db, token: string): Promise<AuthenticatedUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row || row.revokedAt !== null || row.expiresAt <= new Date() || row.status !== "ACTIVE") {
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure, sameSite: "lax", path: "/" });
}
