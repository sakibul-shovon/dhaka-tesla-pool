import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { verify } from "@node-rs/argon2";
import type { Pool } from "pg";
import { createTestPool, testDatabaseUrl } from "../support/db.js";
import { truncateAll } from "../support/truncate.js";
import { runSeed } from "../../src/db/seed/index.js";

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});

afterEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("runSeed", () => {
  it("creates the story cast and is safe to run twice", async () => {
    await runSeed(testDatabaseUrl(), "demo-pass-123");
    await runSeed(testDatabaseUrl(), "demo-pass-123");

    const { rows: users } = await pool.query<{ name: string; role: string }>(
      `SELECT name, role FROM users ORDER BY name`,
    );
    expect(users).toEqual([
      { name: "Admin", role: "ADMIN" },
      { name: "Jashim", role: "DRIVER" },
      { name: "Nusrat", role: "PASSENGER" },
      { name: "Rafiq", role: "PASSENGER" },
      { name: "Shirin", role: "PASSENGER" },
    ]);

    const { rows: vehicleRows } = await pool.query<{
      name: string;
      capacity: number;
      is_online: boolean;
      current_zone: string;
    }>(`SELECT name, capacity, is_online, current_zone FROM vehicles`);
    expect(vehicleRows).toEqual([{ name: "Bullet", capacity: 3, is_online: false, current_zone: "BANANI" }]);

    const {
      rows: [jashim],
    } = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE name = 'Jashim'`);
    expect(await verify(jashim!.password_hash, "demo-pass-123")).toBe(true);
  });
});
