// Real-world approximate coordinates for the 10 fixed Dhaka zones the
// backend knows about (apps/api/src/domain/geography.ts), for MAP DISPLAY
// ONLY. This is a frontend-only, presentational lookup — it is never sent
// to or read from the API, and it carries no authority over anything: the
// zone *code* (e.g. "BANANI") is always the real identifier submitted to
// the backend. See the redesign plan §5 for why this exists instead of a
// real geocoding/GPS pipeline — there isn't one. The backend's own
// geography model is an abstract km grid (`xDkm`/`yDkm`) used only for
// Manhattan-distance matching, not real coordinates, and the PRD explicitly
// keeps it that way ("don't fight map APIs"). Values here are approximate
// on purpose, same as the backend's own grid.
export const ZONE_DISPLAY_COORDS: Record<string, [lat: number, lng: number]> = {
  BANANI: [23.7936, 90.4066],
  GULSHAN_1: [23.7808, 90.4145],
  GULSHAN_2: [23.7925, 90.4183],
  MOHAKHALI: [23.7793, 90.4054],
  TEJGAON: [23.7654, 90.3945],
  FARMGATE: [23.7561, 90.3878],
  DHANMONDI: [23.7461, 90.3742],
  MIRPUR: [23.8041, 90.3654],
  UTTARA: [23.8759, 90.3795],
  BASHUNDHARA: [23.8151, 90.426],
};

// Roughly centers the 10 zones above — the map's default view before any
// zone is selected.
export const DHAKA_CENTER: [lat: number, lng: number] = [23.79, 90.395];
