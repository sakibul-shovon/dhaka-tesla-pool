import { describe, expect, it } from "vitest";
import {
  RIDE_COMMANDS,
  RIDE_STATUSES,
  rideTransition,
  type RideCommand,
  type RideStatus,
  type RideTransitionErrorCode,
} from "../../../src/domain/ride-state-machine.js";

// Mirrors docs/IMPLEMENTATION_PLAN.md §9.1's transition table verbatim,
// including its footnote: "—" (not reachable) behaves the same as a plain
// ❌ (INVALID_TRANSITION) — there is no third outcome. Every (state,
// command) pair is asserted below so this fixture and domain/ride-state-machine.ts
// cannot silently drift apart.
const EXPECTED: Record<RideStatus, Partial<Record<RideCommand, RideStatus | RideTransitionErrorCode>>> = {
  REQUESTED: {
    join: "MATCHED",
    accept: "MATCHED",
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    dropOff: "INVALID_TRANSITION",
    cancel: "CANCELLED",
    markNoShow: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
  },
  MATCHED: {
    join: "REQUEST_NOT_OPEN",
    accept: "REQUEST_NOT_OPEN",
    arrive: "DRIVER_ARRIVED",
    start: "INVALID_TRANSITION",
    dropOff: "INVALID_TRANSITION",
    cancel: "CANCELLED",
    markNoShow: "INVALID_TRANSITION",
    cancelPool: "CANCELLED",
  },
  DRIVER_ARRIVED: {
    join: "INVALID_TRANSITION",
    accept: "INVALID_TRANSITION",
    arrive: "INVALID_TRANSITION",
    start: "STARTED",
    dropOff: "INVALID_TRANSITION",
    cancel: "CANCELLED",
    markNoShow: "CANCELLED",
    cancelPool: "CANCELLED",
  },
  STARTED: {
    join: "INVALID_TRANSITION",
    accept: "INVALID_TRANSITION",
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    dropOff: "COMPLETED",
    cancel: "CANCELLATION_NOT_ALLOWED",
    markNoShow: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
  },
  COMPLETED: {
    join: "INVALID_TRANSITION",
    accept: "INVALID_TRANSITION",
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    dropOff: "INVALID_TRANSITION",
    cancel: "INVALID_TRANSITION",
    markNoShow: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
  },
  CANCELLED: {
    join: "INVALID_TRANSITION",
    accept: "INVALID_TRANSITION",
    arrive: "INVALID_TRANSITION",
    start: "INVALID_TRANSITION",
    dropOff: "INVALID_TRANSITION",
    cancel: "INVALID_TRANSITION",
    markNoShow: "INVALID_TRANSITION",
    cancelPool: "INVALID_TRANSITION",
  },
};

const ERROR_CODES = new Set(["INVALID_TRANSITION", "REQUEST_NOT_OPEN", "CANCELLATION_NOT_ALLOWED"]);

describe("rideTransition (plan §9.1 matrix, all pairs)", () => {
  for (const state of RIDE_STATUSES) {
    for (const command of RIDE_COMMANDS) {
      const expected = EXPECTED[state][command]!;
      it(`${state} --${command}--> ${expected}`, () => {
        const result = rideTransition(state, command);
        if (ERROR_CODES.has(expected)) {
          expect(result).toEqual({ allowed: false, error: expected });
        } else {
          expect(result).toEqual({ allowed: true, to: expected });
        }
      });
    }
  }

  it("covers every declared status and command in the fixture (no silent gaps)", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...RIDE_STATUSES].sort());
    for (const state of RIDE_STATUSES) {
      expect(Object.keys(EXPECTED[state]).sort()).toEqual([...RIDE_COMMANDS].sort());
    }
  });

  it("REQUESTED is the only state that accepts join/accept", () => {
    for (const state of RIDE_STATUSES) {
      if (state === "REQUESTED") continue;
      expect(rideTransition(state, "join")).not.toEqual({ allowed: true, to: "MATCHED" });
      expect(rideTransition(state, "accept")).not.toEqual({ allowed: true, to: "MATCHED" });
    }
  });

  it("cancellation is blocked only once STARTED", () => {
    for (const state of RIDE_STATUSES) {
      const result = rideTransition(state, "cancel");
      if (state === "STARTED") {
        expect(result).toEqual({ allowed: false, error: "CANCELLATION_NOT_ALLOWED" });
      } else if (state === "COMPLETED" || state === "CANCELLED") {
        expect(result).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
      } else {
        expect(result).toEqual({ allowed: true, to: "CANCELLED" });
      }
    }
  });
});
