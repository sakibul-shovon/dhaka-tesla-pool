import { z } from "zod";
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
