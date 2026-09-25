import { describe, expect, it } from "vitest";
import { fingerprintRequest, requireIdempotencyKey } from "../../../src/lib/idempotency.js";
import { HttpError } from "../../../src/http/error-mapper.js";

describe("fingerprintRequest", () => {
  it("is stable regardless of key order in the body", () => {
    const a = fingerprintRequest("POST", "/api/v1/ride-requests", {
      pickupZone: "BANANI",
      dropoffZone: "MOHAKHALI",
      seats: 1,
    });
    const b = fingerprintRequest("POST", "/api/v1/ride-requests", {
      seats: 1,
      dropoffZone: "MOHAKHALI",
      pickupZone: "BANANI",
    });
    expect(a).toBe(b);
  });

  it("changes when the body actually differs", () => {
    const a = fingerprintRequest("POST", "/api/v1/ride-requests", { seats: 1 });
    const b = fingerprintRequest("POST", "/api/v1/ride-requests", { seats: 2 });
    expect(a).not.toBe(b);
  });

  it("changes when the route template differs but the body doesn't", () => {
    const a = fingerprintRequest("POST", "/api/v1/ride-requests", { seats: 1 });
    const b = fingerprintRequest("POST", "/api/v1/ride-requests/:id/cancel", { seats: 1 });
    expect(a).not.toBe(b);
  });
});

describe("requireIdempotencyKey", () => {
  it("accepts a normal header value", () => {
    expect(requireIdempotencyKey("a-real-uuid")).toBe("a-real-uuid");
  });

  it("rejects a missing header", () => {
    expect(() => requireIdempotencyKey(undefined)).toThrow(HttpError);
  });

  it("rejects an empty header", () => {
    expect(() => requireIdempotencyKey("")).toThrow(HttpError);
  });

  it("rejects a header longer than 64 characters", () => {
    expect(() => requireIdempotencyKey("x".repeat(65))).toThrow(HttpError);
  });

  it("rejects a non-string header (repeated header case)", () => {
    expect(() => requireIdempotencyKey(["a", "b"])).toThrow(HttpError);
  });
});
