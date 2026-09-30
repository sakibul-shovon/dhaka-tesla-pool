import type { ReactNode } from "react";

// The "workspace" template (booking, ride tracking, driver dashboard/pool —
// plan round 3 §2/§3): a fixed-width scrollable panel plus a map filling the
// rest of the viewport on desktop, map-on-top over a panel "sheet" on
// mobile. Relies on AppLayout's <main> being a full-bleed flex child (no
// padding/max-width of its own) so this can actually reach the edges.
export function Workspace({ panel, map }: { panel: ReactNode; map: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="order-1 h-[34vh] flex-none lg:order-2 lg:h-auto lg:flex-1">{map}</div>
      <div className="relative order-2 -mt-5 flex-1 overflow-y-auto rounded-t-2xl border-t border-border bg-bg px-4 py-5 sm:px-6 lg:order-1 lg:mt-0 lg:w-[440px] lg:flex-none lg:rounded-none lg:border-t-0 lg:border-r lg:px-6 lg:py-8">
        {panel}
      </div>
    </div>
  );
}
