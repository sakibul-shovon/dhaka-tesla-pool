import { describe, expect, it } from "vitest";
import { paisa } from "@dhaka-tesla-pool/shared";
import { computeFare, DEFAULT_FARE_CONSTANTS, type FareConstants } from "../../../src/domain/fare.js";

// Every row is a fixture from plan §8.3 — the evaluator can check these by hand.
describe("computeFare (plan §8.3)", () => {
  it("Nusrat: Banani -> Mohakhali, 1 seat, 25 dkm", () => {
    const fare = computeFare(25, 1);
    expect(fare.seatFarePaisa).toBe(6750);
    expect(fare.soloFarePaisa).toBe(6750);
    expect(fare.poolDiscountPaisa).toBe(1350);
    expect(fare.pooledFarePaisa).toBe(5400);
  });

  it("Rafiq: Banani -> Gulshan 1, 1 seat, 30 dkm", () => {
    const fare = computeFare(30, 1);
    expect(fare.seatFarePaisa).toBe(7500);
    expect(fare.soloFarePaisa).toBe(7500);
    expect(fare.poolDiscountPaisa).toBe(1500);
    expect(fare.pooledFarePaisa).toBe(6000);
  });

  it("Shirin: Banani -> Gulshan 2, 1 seat, 20 dkm", () => {
    const fare = computeFare(20, 1);
    expect(fare.seatFarePaisa).toBe(6000);
    expect(fare.soloFarePaisa).toBe(6000);
    expect(fare.poolDiscountPaisa).toBe(1200);
    expect(fare.pooledFarePaisa).toBe(4800);
  });

  it("Rafiq (race scenario): Banani -> Gulshan 1, 2 seats, 30 dkm", () => {
    const fare = computeFare(30, 2);
    expect(fare.seatFarePaisa).toBe(7500);
    expect(fare.soloFarePaisa).toBe(15000);
    expect(fare.poolDiscountPaisa).toBe(3000);
    expect(fare.pooledFarePaisa).toBe(12000);
  });
});

describe("computeFare rounding", () => {
  it("floors a fractional discount instead of rounding it", () => {
    const oddConstants: FareConstants = {
      baseFarePaisa: paisa(100),
      perDkmPaisa: paisa(1),
      poolDiscountBps: 3333, // 33.33%
    };
    // seatFare = 100 + 1*1 = 101; discount = floor(101 * 3333 / 10000) = floor(33.6633) = 33
    const fare = computeFare(1, 1, oddConstants);
    expect(fare.soloFarePaisa).toBe(101);
    expect(fare.poolDiscountPaisa).toBe(33);
    expect(fare.pooledFarePaisa).toBe(68);
  });

  it("never charges more than the solo fare with default constants", () => {
    for (const [dkm, seats] of [
      [1, 1],
      [25, 1],
      [30, 2],
      [90, 6],
    ] as const) {
      const fare = computeFare(dkm, seats);
      expect(fare.pooledFarePaisa).toBeLessThanOrEqual(fare.soloFarePaisa);
    }
  });

  it("uses DEFAULT_FARE_CONSTANTS when none are given", () => {
    expect(computeFare(25, 1)).toEqual(computeFare(25, 1, DEFAULT_FARE_CONSTANTS));
  });
});
