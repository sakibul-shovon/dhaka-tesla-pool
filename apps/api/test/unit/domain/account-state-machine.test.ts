import { describe, expect, it } from "vitest";
import {
  ACCOUNT_COMMANDS,
  ACCOUNT_STATUSES,
  accountTransition,
  isSuspendableRole,
  type AccountCommand,
  type AccountStatus,
} from "../../../src/domain/account-state-machine.js";

// Every (state, command) pair is asserted so this fixture and
// domain/account-state-machine.ts cannot silently drift apart (ADR-019).
const EXPECTED: Record<
  AccountStatus,
  Record<AccountCommand, AccountStatus | "INVALID_TRANSITION">
> = {
  ACTIVE: { suspend: "SUSPENDED", reactivate: "INVALID_TRANSITION" },
  SUSPENDED: { suspend: "INVALID_TRANSITION", reactivate: "ACTIVE" },
};

describe("accountTransition (ADR-019, all pairs)", () => {
  for (const state of ACCOUNT_STATUSES) {
    for (const command of ACCOUNT_COMMANDS) {
      const expected = EXPECTED[state][command];
      it(`${state} --${command}--> ${expected}`, () => {
        const result = accountTransition(state, command);
        if (expected === "INVALID_TRANSITION") {
          expect(result).toEqual({ allowed: false, error: "INVALID_TRANSITION" });
        } else {
          expect(result).toEqual({ allowed: true, to: expected });
        }
      });
    }
  }

  it("covers every declared status and command in the fixture (no silent gaps)", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACCOUNT_STATUSES].sort());
    for (const state of ACCOUNT_STATUSES) {
      expect(Object.keys(EXPECTED[state]).sort()).toEqual([...ACCOUNT_COMMANDS].sort());
    }
  });
});

describe("isSuspendableRole", () => {
  it("allows passengers and drivers", () => {
    expect(isSuspendableRole("PASSENGER")).toBe(true);
    expect(isSuspendableRole("DRIVER")).toBe(true);
  });

  it("never allows admins, so an admin can't lock themselves or another admin out", () => {
    expect(isSuspendableRole("ADMIN")).toBe(false);
  });
});
