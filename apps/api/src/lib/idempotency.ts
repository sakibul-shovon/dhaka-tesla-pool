import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Tx } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";
import { HttpError } from "../http/error-mapper.js";

// Idempotency (plan §11, ADR-010): the key is claimed inside the same
// business transaction that does the work, so a claim and its eventual
// response are always committed (or rolled back) together.
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

export function requireIdempotencyKey(headerValue: unknown): string {
  if (
    typeof headerValue !== "string" ||
    headerValue.length === 0 ||
    headerValue.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new HttpError(
      400,
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      "Idempotency-Key header is required.",
    );
  }
  return headerValue;
}

// Deterministic regardless of key insertion order, so the same logical body
// always fingerprints the same way (plan §11: "canonical JSON body").
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprintRequest(method: string, routeTemplate: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${routeTemplate}\n${canonicalJson(body)}`)
    .digest("hex");
}

export interface IdempotencyClaim {
  readonly key: string;
  readonly operation: string;
  readonly fingerprint: string;
}

export type IdempotencyClaimResult =
  | { readonly replayed: false }
  | { readonly replayed: true; readonly responseStatus: number; readonly responseBody: unknown };

// The INSERT is the lock: a concurrent request for the same (user, key)
// blocks on the unique index until this transaction commits (then sees the
// finalized row and replays) or rolls back (then claims it and proceeds) —
// no separate IN_PROGRESS state to get stuck in (plan §11).
export async function claimIdempotencyKey(
  tx: Tx,
  userId: string,
  claim: IdempotencyClaim,
): Promise<IdempotencyClaimResult> {
  const [inserted] = await tx
    .insert(idempotencyKeys)
    .values({
      userId,
      key: claim.key,
      operation: claim.operation,
      requestFingerprint: claim.fingerprint,
      responseStatus: 0,
    })
    .onConflictDoNothing({ target: [idempotencyKeys.userId, idempotencyKeys.key] })
    .returning({ userId: idempotencyKeys.userId });

  if (inserted) {
    return { replayed: false };
  }

  const [existing] = await tx
    .select({
      operation: idempotencyKeys.operation,
      requestFingerprint: idempotencyKeys.requestFingerprint,
      responseStatus: idempotencyKeys.responseStatus,
      responseBody: idempotencyKeys.responseBody,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, claim.key)));

  if (
    !existing ||
    existing.operation !== claim.operation ||
    existing.requestFingerprint !== claim.fingerprint
  ) {
    throw new HttpError(
      422,
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      "This Idempotency-Key was already used for a different request.",
    );
  }

  return {
    replayed: true,
    responseStatus: existing.responseStatus,
    responseBody: existing.responseBody,
  };
}

export async function finalizeIdempotencyKey(
  tx: Tx,
  userId: string,
  key: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus, responseBody })
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
}
