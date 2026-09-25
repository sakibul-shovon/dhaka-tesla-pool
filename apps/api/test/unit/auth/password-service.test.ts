import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/password-service.js";

describe("password-service", () => {
  it("hashes a password and verifies the same password against it", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("returns false (never throws) for an unknown user's undefined hash", async () => {
    await expect(verifyPassword(undefined, "anything")).resolves.toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });
});
