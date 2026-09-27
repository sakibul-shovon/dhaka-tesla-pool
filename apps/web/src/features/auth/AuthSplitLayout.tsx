import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { useZones } from "../../lib/zones.js";
import { ZoneDiagram } from "../../components/map/ZoneDiagram.js";

const GUARANTEES = [
  "Your fare, quoted before you book — never above it",
  "Seats enforced at the database level, never overbooked",
  "Co-riders see a count, never a name",
];

// Shared shell for login/register (plan round 3 §3): form on the left,
// brand/story panel on the right. The panel uses normal theme tokens (not a
// hardcoded "always dark" ink block) on purpose — ZoneDiagram colors follow
// --color-text/--color-border-strong, which flip in dark mode, so a fixed
// dark panel would make the diagram invisible in light mode specifically.
export function AuthSplitLayout({ children }: { children: ReactNode }) {
  const zonesQuery = useZones();
  const zones = zonesQuery.data ?? [];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:px-16 xl:px-24">
        <Link to="/" className="mb-8 flex items-center gap-2 font-display font-semibold text-text">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
            <Zap size={17} strokeWidth={2.5} fill="currentColor" />
          </span>
          Dhaka Tesla Pool
        </Link>
        <div className="mx-auto w-full max-w-sm lg:mx-0">{children}</div>
      </div>

      <div className="hidden flex-1 flex-col justify-between border-l border-border bg-surface-raised px-12 py-16 lg:flex">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent-strong">
            Share a seat. Split the fare.
          </p>
          <h2 className="mt-3 max-w-sm text-balance font-display text-3xl font-bold text-text">
            Ten Dhaka zones, one Tesla at a time.
          </h2>
        </div>
        <div className="mx-auto aspect-square w-full max-w-sm">
          <ZoneDiagram
            zones={zones}
            highlightZoneCodes={["BANANI", "MOHAKHALI", "GULSHAN_1"]}
            connections={[["BANANI", "MOHAKHALI"]]}
            className="h-full w-full"
          />
        </div>
        <ul className="space-y-2.5">
          {GUARANTEES.map((guarantee) => (
            <li key={guarantee} className="flex gap-2.5 text-sm text-text-muted">
              <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
              {guarantee}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
