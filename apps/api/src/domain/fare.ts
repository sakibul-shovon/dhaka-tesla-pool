import { paisa, type Paisa } from "@dhaka-tesla-pool/shared";

// Fare model (plan §8.1): passengerFare = baseFare + distanceCharge - poolDiscount,
// per seat, in integer paisa. Only the discount can be fractional; it is
// floored so a passenger is never charged more than the solo quote.
export interface FareConstants {
  readonly baseFarePaisa: Paisa;
  readonly perDkmPaisa: Paisa;
  readonly poolDiscountBps: number;
}

export const DEFAULT_FARE_CONSTANTS: FareConstants = {
  baseFarePaisa: paisa(3000),
  perDkmPaisa: paisa(150),
  poolDiscountBps: 2000,
};

export interface FareBreakdown {
  readonly distanceDkm: number;
  readonly seats: number;
  readonly seatFarePaisa: Paisa;
  readonly soloFarePaisa: Paisa;
  readonly poolDiscountPaisa: Paisa;
  readonly pooledFarePaisa: Paisa;
}

export function computeFare(
  distanceDkm: number,
  seats: number,
  constants: FareConstants = DEFAULT_FARE_CONSTANTS,
): FareBreakdown {
  const seatFare = constants.baseFarePaisa + constants.perDkmPaisa * distanceDkm;
  const soloFare = seatFare * seats;
  const poolDiscount = Math.floor((soloFare * constants.poolDiscountBps) / 10000);
  const pooledFare = soloFare - poolDiscount;

  return {
    distanceDkm,
    seats,
    seatFarePaisa: paisa(seatFare),
    soloFarePaisa: paisa(soloFare),
    poolDiscountPaisa: paisa(poolDiscount),
    pooledFarePaisa: paisa(pooledFare),
  };
}
