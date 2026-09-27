import { useMemo } from "react";
import type { Zone } from "../../lib/types.js";

// A stylized diagram of the 10-zone grid (built from the same xDkm/yDkm the
// API returns for GET /zones), used only for storytelling on the landing
// page — deliberately not a real map, so it can't be mistaken for one. See
// ZoneMap.tsx for the real-basemap version used on transactional screens.
const VIEW_SIZE = 400;
const PADDING = 48;

interface DiagramPoint {
  x: number;
  y: number;
}

function layoutZones(zones: Zone[]): Map<string, DiagramPoint> {
  const points = new Map<string, DiagramPoint>();
  if (zones.length === 0) return points;

  const xs = zones.map((zone) => zone.xDkm);
  const ys = zones.map((zone) => zone.yDkm);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const usable = VIEW_SIZE - PADDING * 2;

  for (const zone of zones) {
    const x = PADDING + ((zone.xDkm - minX) / spanX) * usable;
    // SVG y grows downward; the grid's y grows north, so invert it.
    const y = PADDING + (1 - (zone.yDkm - minY) / spanY) * usable;
    points.set(zone.code, { x, y });
  }
  return points;
}

export function ZoneDiagram({
  zones,
  highlightZoneCodes = [],
  connections = [],
  className = "",
}: {
  zones: Zone[];
  /** Zone codes to draw larger/brighter, e.g. the ones mentioned in the copy next to the diagram. */
  highlightZoneCodes?: string[];
  /** Pairs of zone codes to connect with a dashed line, e.g. an example trip. */
  connections?: [string, string][];
  className?: string;
}) {
  const points = useMemo(() => layoutZones(zones), [zones]);
  const highlighted = useMemo(() => new Set(highlightZoneCodes), [highlightZoneCodes]);

  return (
    <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className={className} role="img" aria-label="Diagram of Dhaka Tesla Pool zones">
      {connections.map(([fromCode, toCode], index) => {
        const from = points.get(fromCode);
        const to = points.get(toCode);
        if (!from || !to) return null;
        return (
          <line
            key={`${fromCode}-${toCode}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
        );
      })}
      {zones.map((zone) => {
        const point = points.get(zone.code);
        if (!point) return null;
        const isHighlighted = highlighted.has(zone.code);
        return (
          <g key={zone.code}>
            <circle
              cx={point.x}
              cy={point.y}
              r={isHighlighted ? 7 : 4.5}
              fill={isHighlighted ? "var(--color-accent)" : "var(--color-border-strong)"}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
            <text
              x={point.x}
              y={point.y - 12}
              textAnchor="middle"
              fontSize={isHighlighted ? 12 : 10}
              fontWeight={isHighlighted ? 600 : 500}
              fill={isHighlighted ? "var(--color-text)" : "var(--color-text-muted)"}
            >
              {zone.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
