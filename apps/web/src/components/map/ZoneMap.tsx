import { useEffect, useMemo, useRef, type ComponentType } from "react";
import { Map as MapLibreMap, Marker, Source, Layer, type MapRef } from "@vis.gl/react-maplibre";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { Car, Flag, MapPin } from "lucide-react";
import { useTheme } from "../../app/theme.js";
import { DHAKA_CENTER, ZONE_DISPLAY_COORDS } from "./zoneCoords.js";

// Left alone, maplibre-gl looks for its tile-parsing worker as a sibling
// file literally named "maplibre-gl-worker.mjs" next to whatever file its
// own code was bundled into. Copying that file into the build (the previous
// approach) left two problems: the name carries no content hash, so a
// browser that once cached a bad response for it — Netlify served its SPA
// fallback HTML there, under /assets/*'s year-long immutable cache — kept the
// map blank across every later redeploy; and nginx's mime.types has no .mjs
// entry, so the Docker Compose build served it as application/octet-stream,
// which browsers refuse to run as a module. Letting Vite bundle the worker
// instead yields a content-hashed .js file that every static host serves as
// JavaScript. Module scope, so it runs before any map is created.
setWorkerUrl(maplibreWorkerUrl);

// Free vector tiles, no API key / account / quota (plan §5) — matches the
// PRD's free-tier-only rule with zero billing risk. Positron over the
// busier "liberty" style in light mode (plan round 3: "calmer, more
// premium"); react-maplibre's Map applies a mapStyle change live via
// map.setStyle, so this can just follow the resolved theme.
const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const MAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

export type ZoneMarkerTone = "pickup" | "dropoff" | "driver";

export interface ZoneMapMarker {
  zoneCode: string;
  label: string;
  tone: ZoneMarkerTone;
}

// Fixed colors, not theme tokens: a marker's own fill doesn't get lighter
// just because the page went dark — "dropoff" specifically must NOT follow
// `--color-text`, which is exactly the token that flips brightness between
// themes and would turn this pin invisible-on-itself in dark mode.
const TONE_STYLES: Record<
  ZoneMarkerTone,
  { className: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }> }
> = {
  pickup: { className: "bg-accent text-on-accent", Icon: MapPin },
  dropoff: { className: "bg-[#241c13] text-white", Icon: Flag },
  driver: { className: "bg-electric text-white", Icon: Car },
};

// Deliberately NOT a routed path — a straight dashed line between pickup
// and drop-off, matching what the backend actually models (Manhattan
// distance between two zone points, no real routing). Never draw this as a
// solid line or animate a vehicle smoothly along it: that would imply live
// GPS/turn-by-turn routing the system doesn't have (plan §5, ADR-008).
function useRouteLine(markers: ZoneMapMarker[], showRoute: boolean) {
  return useMemo(() => {
    if (!showRoute) return null;
    const pickup = markers.find((m) => m.tone === "pickup");
    const dropoff = markers.find((m) => m.tone === "dropoff");
    if (!pickup || !dropoff) return null;
    const from = ZONE_DISPLAY_COORDS[pickup.zoneCode];
    const to = ZONE_DISPLAY_COORDS[dropoff.zoneCode];
    if (!from || !to) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [from[1], from[0]],
          [to[1], to[0]],
        ],
      },
    };
  }, [markers, showRoute]);
}

export function ZoneMap({
  markers,
  showRoute = false,
  interactive = true,
  className = "",
}: {
  markers: ZoneMapMarker[];
  showRoute?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const route = useRouteLine(markers, showRoute);
  const mapRef = useRef<MapRef>(null);
  const { resolvedDark } = useTheme();

  const located = markers
    .map((marker) => ({ marker, coords: ZONE_DISPLAY_COORDS[marker.zoneCode] }))
    .filter((entry): entry is { marker: ZoneMapMarker; coords: [number, number] } =>
      Boolean(entry.coords),
    );

  const center =
    located.length > 0
      ? ([
          located.reduce((sum, entry) => sum + entry.coords[0], 0) / located.length,
          located.reduce((sum, entry) => sum + entry.coords[1], 0) / located.length,
        ] as const)
      : DHAKA_CENTER;
  const zoom = located.length > 1 ? 12.5 : 13.5;

  // initialViewState only applies on first mount (it's an uncontrolled prop
  // by design in this library) — a later zone selection needs an explicit
  // flyTo, which is also the "pin drop" wow-moment from the animation plan
  // (§8.6) rather than a jarring re-center. Skipped on the first render
  // since initialViewState already put the camera there.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mapRef.current?.getMap().flyTo({ center: [center[1], center[0]], zoom, duration: 900 });
    // Only the coordinates/zoom should retrigger this — not `center`/`zoom`
    // as fresh array/number identities, which would fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], zoom]);

  return (
    <div className={className} aria-hidden={!interactive}>
      <MapLibreMap
        ref={mapRef}
        initialViewState={{ longitude: center[1], latitude: center[0], zoom }}
        mapStyle={resolvedDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        style={{ width: "100%", height: "100%" }}
        dragPan={interactive}
        dragRotate={false}
        scrollZoom={interactive}
        doubleClickZoom={interactive}
        touchZoomRotate={interactive}
        keyboard={interactive}
        attributionControl={{ compact: true }}
      >
        {route && (
          <Source id="zone-route" type="geojson" data={route}>
            <Layer
              id="zone-route-line"
              type="line"
              paint={{
                "line-color": resolvedDark ? "#b6ab97" : "#6e6455",
                "line-width": 2,
                "line-dasharray": [2, 2],
              }}
            />
          </Source>
        )}
        {located.map(({ marker, coords }) => {
          const { className: toneClassName, Icon } = TONE_STYLES[marker.tone];
          return (
            <Marker key={marker.zoneCode} longitude={coords[1]} latitude={coords[0]}>
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface shadow-md ${toneClassName}`}
                >
                  <Icon size={15} strokeWidth={2.5} />
                </span>
                <span className="whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-text shadow-sm">
                  {marker.label}
                </span>
              </div>
            </Marker>
          );
        })}
      </MapLibreMap>
    </div>
  );
}
