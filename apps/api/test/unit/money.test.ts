import { describe, expect, it } from "vitest";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";

describe("paisa", () => {
  it("accepts integers", () => {
    expect(paisa(5400)).toBe(5400);
  });

  it("rejects non-integers", () => {
    expect(() => paisa(54.5)).toThrow(RangeError);
  });
});

describe("formatPaisaAsTaka", () => {
  it("formats whole paisa as two-decimal taka", () => {
    expect(formatPaisaAsTaka(paisa(5400))).toBe("৳54.00");
    expect(formatPaisaAsTaka(paisa(6750))).toBe("৳67.50");
  });

  it("formats zero", () => {
    expect(formatPaisaAsTaka(paisa(0))).toBe("৳0.00");
  });
});
