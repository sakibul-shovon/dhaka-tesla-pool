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
  });
});
