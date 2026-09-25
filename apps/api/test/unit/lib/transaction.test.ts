import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../src/db/client.js";
import { runInTransaction } from "../../../src/lib/transaction.js";

describe("runInTransaction", () => {
  it("delegates to db.transaction and returns its result", async () => {
    const fakeTx = { marker: "tx" };
    const transaction = vi.fn(async (fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx));
    const db = { transaction } as unknown as Db;

    const result = await runInTransaction(db, async (tx) => {
      expect(tx).toBe(fakeTx);
      return "done";
    });

    expect(result).toBe("done");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejection from the callback without swallowing it", async () => {
    const db = { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) } as unknown as Db;

    await expect(
      runInTransaction(db, async () => {
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
  });
});
