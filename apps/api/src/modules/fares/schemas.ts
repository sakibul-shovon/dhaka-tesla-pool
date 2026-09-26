import { z } from "zod";
import { ZONE_GRID, type ZoneCode } from "../../domain/geography.js";

const ZONE_CODES = Object.keys(ZONE_GRID) as [ZoneCode, ...ZoneCode[]];

export const zoneCodeSchema = z.enum(ZONE_CODES);

// Product policy caps a single booking at 3 seats — Bullet's own capacity,
// and the only vehicle this MVP has (plan A23; the DB's own CHECK stays the
// wider 1..6 physical range as a backstop, matching vehicles_capacity_range).
// Revisit as a config value once a vehicle with a different capacity exists.
export const MAX_SEATS_PER_REQUEST = 3;

// Shared by fare-quotes and ride-request creation (plan §12.2): both quote a
// trip, one of them also stores it. Exported unrefined so ride-requests'
// schema can `.extend()` it with `paymentMethod` before adding the same
// pickup-ne-dropoff refinement.
export const tripFieldsSchema = z.object({
  pickupZone: zoneCodeSchema,
  dropoffZone: zoneCodeSchema,
  seats: z.number().int().min(1).max(MAX_SEATS_PER_REQUEST),
});

export function refinePickupNeDropoff<T extends { pickupZone: string; dropoffZone: string }>(value: T): boolean {
  return value.pickupZone !== value.dropoffZone;
}

export const tripInputSchema = tripFieldsSchema
  .strict()
  .refine(refinePickupNeDropoff, {
    message: "Pickup and drop-off zone must differ.",
    path: ["dropoffZone"],
  });

export type TripInput = z.infer<typeof tripInputSchema>;
