import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createTestPool } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { createDb, type Db } from "../../src/db/client.js";
import { createSession, resolveSession, revokeSession } from "../../src/modules/auth/session-service.js";

let pool: Pool;
let db: Db;

beforeAll(() => {
  pool = createTestPool();
  db = createDb(pool);
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function insertUser(status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const {
    rows: [row],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, status) VALUES ('Test', $1, 'x', 'PASSENGER', $2) RETURNING id`,
    [`${randomUUID()}@dhakateslapool.test`, status],
  );
  return row!.id;
}

describe("session-service", () => {
  it("resolves a freshly created session to its user", async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, userId, 1);

    const resolved = await resolveSession(db, token);

    expect(resolved?.id).toBe(userId);
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveSession(db, "not-a-real-token")).toBeNull();
  });

  it("returns null after the session is revoked", async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, userId, 1);

    await revokeSession(db, token);

    expect(await resolveSession(db, token)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const userId = await insertUser();
    const { token } = await createSession(db, userId, -1); // already expired

    expect(await resolveSession(db, token)).toBeNull();
  });

  it("returns null for a suspended user's session", async () => {
    const userId = await insertUser("SUSPENDED");
    const { token } = await createSession(db, userId, 1);

    expect(await resolveSession(db, token)).toBeNull();
  });
});
