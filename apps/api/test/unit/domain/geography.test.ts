import { describe, expect, it } from "vitest";
import { manhattanDistanceDkm, UnknownZoneError } from "../../../src/domain/geography.js";

describe("manhattanDistanceDkm", () => {
  it.each([
    ["BANANI", "MOHAKHALI", 25],
    ["BANANI", "GULSHAN_1", 30],
    ["BANANI", "GULSHAN_2", 20],
    ["MOHAKHALI", "GULSHAN_1", 25],
    ["GULSHAN_1", "GULSHAN_2", 20],
    ["MOHAKHALI", "GULSHAN_2", 45],
  ])("%s -> %s is %i dkm (plan §7.1)", (from, to, expected) => {
    expect(manhattanDistanceDkm(from, to)).toBe(expected);
  });

  it("is exactly the 3.5 km pool boundary between Gulshan 2 and Bashundhara", () => {
    expect(manhattanDistanceDkm("GULSHAN_2", "BASHUNDHARA")).toBe(35);
  });

  it("is symmetric", () => {
    expect(manhattanDistanceDkm("BANANI", "UTTARA")).toBe(manhattanDistanceDkm("UTTARA", "BANANI"));
  });

  it("is zero for the same zone", () => {
    expect(manhattanDistanceDkm("DHANMONDI", "DHANMONDI")).toBe(0);
  });

  it("rejects an unknown zone", () => {
    expect(() => manhattanDistanceDkm("BANANI", "NARAYANGANJ")).toThrow(UnknownZoneError);
  });
});
