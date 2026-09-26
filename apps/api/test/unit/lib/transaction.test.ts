import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../../src/db/client.js";
import { HttpError } from "../../../src/http/error-mapper.js";
import { runInTransaction } from "../../../src/lib/transaction.js";

function fakeTx() {
  return { marker: "tx", execute: vi.fn(async () => undefined) };
}

function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function fakeDb(transaction: Db["transaction"]): Db {
  return { transaction } as unknown as Db;
}

describe("runInTransaction (plan §10.3)", () => {
  it("delegates to db.transaction, sets lock/statement timeouts, and returns its result", async () => {
    const tx = fakeTx();
    const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx));
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    const result = await runInTransaction(db, async (t) => {
      expect(t).toBe(tx);
      return "done";
    });

    expect(result).toBe("done");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("propagates a business HttpError without retrying", async () => {
    const transaction = vi.fn(async (fn: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>) => fn(fakeTx()));
    const db = fakeDb(transaction as unknown as Db["transaction"]);
    const businessError = new HttpError(409, "POOL_CAPACITY_EXCEEDED", "full");

    await expect(runInTransaction(db, async () => { throw businessError; })).rejects.toBe(businessError);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("retries on deadlock_detected (40P01) and succeeds on the second attempt", async () => {
    let calls = 0;
    const transaction = vi.fn(async (fn: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>) => {
      calls += 1;
      if (calls === 1) throw pgError("40P01");
      return fn(fakeTx());
    });
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    const result = await runInTransaction(db, async () => "recovered");

    expect(result).toBe("recovered");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("retries on serialization_failure (40001) up to 3 attempts, then rethrows", async () => {
    const err = pgError("40001");
    const transaction = vi.fn(async () => {
      throw err;
    });
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    await expect(runInTransaction(db, async () => "unreachable")).rejects.toBe(err);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("maps lock_not_available (55P03) straight to 503 SERVICE_BUSY without retrying", async () => {
    const transaction = vi.fn(async () => {
      throw pgError("55P03");
    });
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    const error = await runInTransaction(db, async () => "unreachable").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as HttpError).code).toBe("SERVICE_BUSY");
    expect((error as HttpError).retryAfterSeconds).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("maps statement_timeout's query_canceled (57014) to 503 SERVICE_BUSY", async () => {
    const transaction = vi.fn(async () => {
      throw pgError("57014");
    });
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    const error = await runInTransaction(db, async () => "unreachable").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
  });

  it("does not retry an unrelated error (e.g. a constraint violation)", async () => {
    const err = pgError("23505");
    const transaction = vi.fn(async () => {
      throw err;
    });
    const db = fakeDb(transaction as unknown as Db["transaction"]);

    await expect(runInTransaction(db, async () => "unreachable")).rejects.toBe(err);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
