// "Dhaka on graph paper" (plan §7.1): each zone is a point on a km grid,
// stored in tenths of a km (dkm) so distance is an exact integer. Distance
// is Manhattan (|dx| + |dy|) — a crude but honest model of grid streets,
// and computable by hand. These coordinates are the authoritative copy for
// domain math; the `zones` table (seeded by a migration) carries the same
// values for the `GET /zones` listing and FK integrity — keep both in sync.
export interface ZoneCoordinates {
  readonly xDkm: number;
  readonly yDkm: number;
}

export const ZONE_GRID = {
  BANANI: { xDkm: 0, yDkm: 0 },
  GULSHAN_1: { xDkm: 15, yDkm: -15 },
  GULSHAN_2: { xDkm: 15, yDkm: 5 },
  MOHAKHALI: { xDkm: -5, yDkm: -20 },
  TEJGAON: { xDkm: 0, yDkm: -35 },
  FARMGATE: { xDkm: -20, yDkm: -45 },
  DHANMONDI: { xDkm: -30, yDkm: -70 },
  MIRPUR: { xDkm: -50, yDkm: 0 },
  UTTARA: { xDkm: 5, yDkm: 90 },
  BASHUNDHARA: { xDkm: 40, yDkm: 15 },
} as const satisfies Record<string, ZoneCoordinates>;

export type ZoneCode = keyof typeof ZONE_GRID;

export class UnknownZoneError extends Error {
  constructor(public readonly code: string) {
    super(`Unknown zone: ${code}`);
  }
}

export function isZoneCode(code: string): code is ZoneCode {
  return Object.hasOwn(ZONE_GRID, code);
}

function coordinatesOf(code: string): ZoneCoordinates {
  if (!isZoneCode(code)) {
    throw new UnknownZoneError(code);
  }
  return ZONE_GRID[code];
}

export function manhattanDistanceDkm(a: string, b: string): number {
  const from = coordinatesOf(a);
  const to = coordinatesOf(b);
  return Math.abs(from.xDkm - to.xDkm) + Math.abs(from.yDkm - to.yDkm);
}
