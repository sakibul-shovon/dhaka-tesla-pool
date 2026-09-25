import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../http/pagination.js";
import { RIDE_STATUSES } from "../../domain/ride-state-machine.js";
import { refinePickupNeDropoff, tripFieldsSchema } from "../fares/schemas.js";

// TESLAPAY is P2 (plan §8.4) — the wallet doesn't exist yet, so accepting it
// here would create a request no drop-off flow can ever settle. CASH only
// until that session lands.
export const createRideRequestSchema = tripFieldsSchema
  .extend({ paymentMethod: z.literal("CASH") })
  .strict()
  .refine(refinePickupNeDropoff, {
    message: "Pickup and drop-off zone must differ.",
    path: ["dropoffZone"],
  });

export type CreateRideRequestInput = z.infer<typeof createRideRequestSchema>;

export const listRideRequestsQuerySchema = z
  .object({
    status: z.enum(RIDE_STATUSES).optional(),
    cursor: z.string().min(1).optional(),
    // "larger -> 400, not silently clamped" (plan §12.1) — `.max()` does
    // exactly that; `.default()` only fills in a genuinely missing param.
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .strict();

export type ListRideRequestsQuery = z.infer<typeof listRideRequestsQuerySchema>;
