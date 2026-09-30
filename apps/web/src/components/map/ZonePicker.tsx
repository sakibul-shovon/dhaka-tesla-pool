import { lazy, Suspense } from "react";
import { Select } from "../ui/Select.js";
import { Skeleton } from "../ui/Skeleton.js";
import type { Zone } from "../../lib/types.js";
import type { ZoneMarkerTone } from "./ZoneMap.js";

// The map preview is a separate lazy chunk so pages that never render a
// ZonePicker (login, the marketing landing page, history screens) don't
// pay for MapLibre's bundle weight at all (plan §5/§9).
const ZoneMap = lazy(() => import("./ZoneMap.js").then((module) => ({ default: module.ZoneMap })));

export function ZonePicker({
  id,
  label,
  value,
  onChange,
  zones,
  tone = "pickup",
  placeholder = "Choose a zone",
  disabled,
  excludeZoneCode,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (zoneCode: string) => void;
  zones: Zone[] | undefined;
  tone?: ZoneMarkerTone;
  placeholder?: string;
  disabled?: boolean;
  /** e.g. the drop-off picker excludes whatever the pickup picker already chose. */
  excludeZoneCode?: string;
}) {
  const options = (zones ?? []).filter((zone) => zone.code !== excludeZoneCode);
  const selected = options.find((zone) => zone.code === value);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
      </label>
      <Select id={id} required value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((zone) => (
          <option key={zone.code} value={zone.code}>
            {zone.name}
          </option>
        ))}
      </Select>
      {/* The dropdown above is the real, always-accessible control; this is
          a purely supplementary visual preview (plan §5) — screen readers
          and slow connections lose nothing if it never loads. */}
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <ZoneMap
          className="h-32 w-full overflow-hidden rounded-xl border border-border"
          interactive={false}
          markers={selected ? [{ zoneCode: selected.code, label: selected.name, tone }] : []}
        />
      </Suspense>
    </div>
  );
}
