import { describe, expect, it } from "vitest";
import { createLockOrderGuard } from "../../../src/lib/lock-order.js";

describe("LockOrderGuard (plan §10.2)", () => {
  it("allows the documented order: vehicle -> pool -> requests", () => {
    const guard = createLockOrderGuard();
    expect(() => {
      guard.assert("vehicle");
      guard.assert("pool");
      guard.assert("requests");
    }).not.toThrow();
  });

  it("allows skipping stages that a call site doesn't need", () => {
    const guard = createLockOrderGuard();
    expect(() => {
      guard.assert("pool");
      guard.assert("requests");
    }).not.toThrow();
  });

  it("allows locking requests more than once (ascending-id batches)", () => {
    const guard = createLockOrderGuard();
    expect(() => {
      guard.assert("requests");
      guard.assert("requests");
    }).not.toThrow();
  });

  it("rejects locking a vehicle after a pool is already locked", () => {
    const guard = createLockOrderGuard();
    guard.assert("pool");
    expect(() => guard.assert("vehicle")).toThrow(/Lock order violation/);
  });

  it("rejects locking a pool after requests are already locked", () => {
    const guard = createLockOrderGuard();
    guard.assert("requests");
    expect(() => guard.assert("pool")).toThrow(/Lock order violation/);
  });
});
