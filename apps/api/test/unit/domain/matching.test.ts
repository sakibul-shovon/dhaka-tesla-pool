import { describe, expect, it } from "vitest";
import { canJoin, type PoolForMatching, type RequestForMatching } from "../../../src/domain/matching.js";

const openPool: PoolForMatching = { status: "OPEN", pickupZone: "BANANI", capacityRemaining: 2 };
const requestedRequest = (overrides: Partial<RequestForMatching> = {}): RequestForMatching => ({
  status: "REQUESTED",
  seats: 1,
  pickupZone: "BANANI",
  dropoffZone: "MOHAKHALI",
  ...overrides,
});

describe("canJoin (plan §7.2)", () => {
  it("Nusrat + Rafiq are compatible (2.5 km spread)", () => {
    const rafiq = requestedRequest({ dropoffZone: "GULSHAN_1" });
    const result = canJoin(openPool, rafiq, [{ dropoffZone: "MOHAKHALI" }]);
    expect(result).toEqual({ compatible: true });
  });

  it("Nusrat + Shirin are incompatible (4.5 km spread)", () => {
    const shirin = requestedRequest({ dropoffZone: "GULSHAN_2" });
    const result = canJoin(openPool, shirin, [{ dropoffZone: "MOHAKHALI" }]);
    expect(result).toEqual({ compatible: false, reason: "POOL_INCOMPATIBLE" });
  });

  it("is compatible exactly at the 3.5 km boundary (inclusive)", () => {
    const toBashundhara = requestedRequest({ dropoffZone: "BASHUNDHARA" });
    const result = canJoin(openPool, toBashundhara, [{ dropoffZone: "GULSHAN_2" }]);
    expect(result).toEqual({ compatible: true });
  });

  it("rejects a different pickup zone", () => {
    const fromMohakhali = requestedRequest({ pickupZone: "MOHAKHALI" });
    const result = canJoin(openPool, fromMohakhali, []);
    expect(result).toEqual({ compatible: false, reason: "POOL_INCOMPATIBLE" });
  });

  it("reports capacity before compatibility when both are violated", () => {
    const fullPool: PoolForMatching = { ...openPool, capacityRemaining: 0 };
    const incompatiblePickup = requestedRequest({ pickupZone: "MOHAKHALI" });
    const result = canJoin(fullPool, incompatiblePickup, []);
    expect(result).toEqual({ compatible: false, reason: "POOL_CAPACITY_EXCEEDED" });
  });

  it("rejects joining a pool that isn't OPEN", () => {
    const startedPool: PoolForMatching = { ...openPool, status: "STARTED" };
    const result = canJoin(startedPool, requestedRequest(), []);
    expect(result).toEqual({ compatible: false, reason: "POOL_NOT_ACCEPTING" });
  });

  it("rejects a request that isn't REQUESTED", () => {
    const alreadyMatched = requestedRequest({ status: "MATCHED" });
    const result = canJoin(openPool, alreadyMatched, []);
    expect(result).toEqual({ compatible: false, reason: "REQUEST_NOT_OPEN" });
  });

  it("is compatible with no existing members when pickup and capacity are fine", () => {
    const result = canJoin(openPool, requestedRequest(), []);
    expect(result).toEqual({ compatible: true });
  });
});
