import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../auth/password-service.js";
import { zoneCodeSchema } from "../fares/schemas.js";

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
