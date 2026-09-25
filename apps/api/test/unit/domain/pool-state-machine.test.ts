import { describe, expect, it } from "vitest";
import {
  POOL_COMMANDS,
  POOL_STATUSES,
  poolTransition,
  type PoolCommand,
  type PoolStatus,
} from "../../../src/domain/pool-state-machine.js";

// Mirrors docs/IMPLEMENTATION_PLAN.md §9.2's pool transition table verbatim.
// Every (state, command) pair is asserted so this fixture and
// domain/pool-state-machine.ts cannot silently drift apart.
const EXPECTED: Record<PoolStatus, Record<PoolCommand, PoolStatus | "INVALID_TRANSITION">> = {
  OPEN: {
    arrive: "DRIVER_ARRIVED",
    start: "INVALID_TRANSITION",
    complete: "INVALID_TRANSITION",
    cancelPool: "CANCELLED",
    emptyCancel: "CANCELLED",
  },
  DRIVER_ARRIVED: {
    arrive: "INVALID_TRANSITION",
    start: "STARTED",
    complete: "INVALID_TRANSITION",
    cancelPool: "CANCELLED",
    emptyCancel: "CANCELLED",
  },
  STARTED: {
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    complete: "COMPLETED",
    cancelPool: "INVALID_TRANSITION",
    emptyCancel: "INVALID_TRANSITION",
  },
  COMPLETED: {
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    complete: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
    emptyCancel: "INVALID_TRANSITION",
  },
  CANCELLED: {
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    complete: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
    emptyCancel: "INVALID_TRANSITION",
  },
};

describe("poolTransition (plan §9.2 matrix, all pairs)", () => {
  for (const state of POOL_STATUSES) {
    for (const command of POOL_COMMANDS) {
      const expected = EXPECTED[state][command];
      it(`${state} --${command}--> ${expected}`, () => {
        const result = poolTransition(state, command);
        if (expected === "INVALID_TRANSITION") {
          expect(result).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
        } else {
          expect(result).toEqual({ allowed: true, to: expected });
        }
      });
    }
  }

  it("covers every declared status and command in the fixture (no silent gaps)", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...POOL_STATUSES].sort());
    for (const state of POOL_STATUSES) {
      expect(Object.keys(EXPECTED[state]).sort()).toEqual([...POOL_COMMANDS].sort());
    }
  });

  it("rejects starting before the driver has arrived (C7)", () => {
    expect(poolTransition("OPEN", "start")).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
  });

  it("rejects a second arrive once the pool is already DRIVER_ARRIVED (C7)", () => {
    expect(poolTransition("DRIVER_ARRIVED", "arrive")).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
  });

  it("rejects completing before the pool has started (C8)", () => {
    for (const state of POOL_STATUSES) {
      if (state === "STARTED") continue;
      expect(poolTransition(state, "complete")).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
    }
  });
});
