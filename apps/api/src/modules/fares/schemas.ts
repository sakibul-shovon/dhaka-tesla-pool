import { z } from "zod";
import { ZONE_GRID, type ZoneCode } from "../../domain/geography.js";

const ZONE_CODES = Object.keys(ZONE_GRID) as [ZoneCode, ...ZoneCode[]];

export const zoneCodeSchema = z.enum(ZONE_CODES);

// Shared by fare-quotes and ride-request creation (plan §12.2): both quote a
// trip, one of them also stores it. `seats` matches the DB's CHECK range —
// this does not know or care about any particular vehicle's capacity, since
// a request isn't matched to one yet.
export const tripInputSchema = z
  .object({
    pickupZone: zoneCodeSchema,
    dropoffZone: zoneCodeSchema,
    seats: z.number().int().min(1).max(6),
  })
  .strict()
  .refine((value) => value.pickupZone !== value.dropoffZone, {
    message: "Pickup and drop-off zone must differ.",
    path: ["dropoffZone"],
  });

export type TripInput = z.infer<typeof tripInputSchema>;
