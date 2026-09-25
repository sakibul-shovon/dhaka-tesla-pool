import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Computed once, on first use, and reused for the life of the process — not
// a real credential, just something with the same verification cost as a
// real hash so an unknown-email login takes the same time as a wrong
// password (plan §13.1: timing-safe rejection).
let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= hash("not-a-real-password-used-only-for-timing-safety");
  return dummyHash;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// Pass `undefined` when no user was found for the attempted email — this
// still does a full Argon2id verify against the dummy hash before returning
// false, so the response time doesn't reveal whether the email exists.
export async function verifyPassword(storedHash: string | undefined, password: string): Promise<boolean> {
  if (storedHash === undefined) {
    await verify(await getDummyHash(), password);
    return false;
  }
  return verify(storedHash, password);
}
