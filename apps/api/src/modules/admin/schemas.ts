import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../auth/password-service.js";
import { zoneCodeSchema } from "../fares/schemas.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../http/pagination.js";

// Mirrors vehicles.capacity's own CHECK (1..6, plan A2/ERD) — the DB stays
// the real backstop. Zone is optional: a freshly provisioned Tesla starts
// offline (vehicles_online_requires_zone only forces one once it goes
// online), and the driver can set it themselves from go-online.
export const createDriverSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
    vehicleName: z.string().trim().min(1).max(60),
    capacity: z.number().int().min(1).max(6),
    zone: zoneCodeSchema.optional(),
  })
  .strict();

export type CreateDriverInput = z.infer<typeof createDriverSchema>;

// Mirrors driver/pools' own cancel-with-reason schema — an optional, bounded
// free-text audit note, never required.
export const accountStatusChangeSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type AccountStatusChangeInput = z.infer<typeof accountStatusChangeSchema>;

// The user directory (ADR-019): every filter optional, `q` bounded so a
// pathological search string can't turn into an unbounded ILIKE scan.
export const listUsersQuerySchema = z
  .object({
    role: z.enum(["PASSENGER", "DRIVER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
