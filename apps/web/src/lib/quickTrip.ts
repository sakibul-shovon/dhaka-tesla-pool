// Hand-off from the landing page's quick-trip widget to the passenger
// booking form (plan round 3 §3): sessionStorage only, best-effort — booking
// works fine without it, this only saves a couple of taps for someone who
// just picked a route on the marketing page and registered.
const QUICK_TRIP_KEY = "dtp-quick-trip";

export interface QuickTrip {
  pickup: string;
  dropoff: string;
}

export function saveQuickTrip(trip: QuickTrip): void {
  try {
    sessionStorage.setItem(QUICK_TRIP_KEY, JSON.stringify(trip));
  } catch {
    // Best-effort only.
  }
}

// Read-only — safe to call from a useState lazy initializer, which React
// Strict Mode invokes twice in development. A "consume and remove" version
// would lose the value on the discarded first call.
export function peekQuickTrip(): QuickTrip | null {
  try {
    const raw = sessionStorage.getItem(QUICK_TRIP_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as QuickTrip).pickup === "string" &&
      typeof (parsed as QuickTrip).dropoff === "string"
    ) {
      return parsed as QuickTrip;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearQuickTrip(): void {
  try {
    sessionStorage.removeItem(QUICK_TRIP_KEY);
  } catch {
    // Nothing to clean up if storage isn't available.
  }
}
