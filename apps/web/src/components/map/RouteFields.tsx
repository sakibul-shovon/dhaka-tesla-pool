import type { Zone } from "../../lib/types.js";
import { Select } from "../ui/Select.js";

// Connected pickup/drop-off input (plan round 3 §3: "coloured dots + dotted
// connector, Uber-style") — replaces two separate ZonePicker instances (each
// with its own redundant embedded map preview) now that booking pages show
// one shared map in the Workspace template instead.
export function RouteFields({
  zones,
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
}: {
  zones: Zone[] | undefined;
  pickup: string;
  dropoff: string;
  onPickupChange: (zone: string) => void;
  onDropoffChange: (zone: string) => void;
}) {
  const options = zones ?? [];

  return (
    <div className="relative rounded-2xl border border-border-strong bg-surface-raised">
      <span
        className="absolute left-[27px] top-11 bottom-11 w-px border-l-2 border-dotted border-border-strong"
        aria-hidden
      />
      <div className="flex items-center gap-3 border-b border-border px-3.5 py-1">
        <span
          className="h-2.5 w-2.5 flex-none rounded-full bg-accent ring-2 ring-border-strong"
          aria-hidden
        />
        <Select
          aria-label="Pickup zone"
          value={pickup}
          onChange={(event) => onPickupChange(event.target.value)}
          required
          className="border-0 bg-transparent py-1.5 pl-0 pr-8 focus:ring-0"
        >
          <option value="" disabled>
            Pickup zone
          </option>
          {options.map((zone) => (
            <option key={zone.code} value={zone.code}>
              {zone.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-3 px-3.5 py-1">
        <span
          className="h-2.5 w-2.5 flex-none rounded-full bg-[#241c13] ring-2 ring-border-strong"
          aria-hidden
        />
        <Select
          aria-label="Drop-off zone"
          value={dropoff}
          onChange={(event) => onDropoffChange(event.target.value)}
          required
          className="border-0 bg-transparent py-1.5 pl-0 pr-8 focus:ring-0"
        >
          <option value="" disabled>
            Drop-off zone
          </option>
          {options
            .filter((zone) => zone.code !== pickup)
            .map((zone) => (
              <option key={zone.code} value={zone.code}>
                {zone.name}
              </option>
            ))}
        </Select>
      </div>
    </div>
  );
}
