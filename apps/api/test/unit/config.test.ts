import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
  });

  it("throws when PORT is not a number", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x", PORT: "not-a-port" })).toThrow(EnvValidationError);
  });

  it("throws when NODE_ENV is an unknown value", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x", NODE_ENV: "staging" })).toThrow(EnvValidationError);
  });

  it("applies defaults for optional fields", () => {
    const env = parseEnv({ DATABASE_URL: "postgres://x" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SESSION_TTL_HOURS).toBe(168);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.TRUST_PROXY).toBe(0);
  });

  it("parses COOKIE_SECURE=true as a real boolean, not Boolean(string)", () => {
    expect(parseEnv({ DATABASE_URL: "postgres://x", COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ DATABASE_URL: "postgres://x", COOKIE_SECURE: "false" }).COOKIE_SECURE).toBe(false);
  });

  it("throws when COOKIE_SECURE is not exactly 'true' or 'false'", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x", COOKIE_SECURE: "yes" })).toThrow(EnvValidationError);
  });
});
