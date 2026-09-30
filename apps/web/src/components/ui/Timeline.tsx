const STATUS_LABELS: Record<string, string> = {
  OPEN: "Pool opened",
  REQUESTED: "Requested",
  MATCHED: "Matched with a Tesla",
  DRIVER_ARRIVED: "Driver arrived",
  STARTED: "Trip started",
  COMPLETED: "Trip completed",
  CANCELLED: "Cancelled",
};

const STATUS_DOT_CLASSES: Record<string, string> = {
  OPEN: "bg-text-faint",
  REQUESTED: "bg-text-faint",
  MATCHED: "bg-accent",
  DRIVER_ARRIVED: "bg-accent",
  STARTED: "bg-electric",
  COMPLETED: "bg-success",
  CANCELLED: "bg-danger",
};

// Shared by the ride and pool timelines (plan: "reuse existing
// components") — both history rows have this exact shape, just drawn from
// a different status enum.
export interface TimelineEntry {
  id: number;
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-text-muted">No history yet.</p>;
  }

  return (
    <ol className="space-y-4">
      {entries.map((entry, index) => (
        <li key={entry.id} className="flex items-start gap-3 text-sm">
          <div className="flex flex-col items-center self-stretch">
            <span
              className={"mt-1 h-2.5 w-2.5 flex-none rounded-full " + (STATUS_DOT_CLASSES[entry.toStatus] ?? "bg-text-faint")}
              aria-hidden
            />
            {index < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className="pb-1">
            <p className="font-medium text-text">{STATUS_LABELS[entry.toStatus] ?? entry.toStatus}</p>
            <p className="font-mono text-xs text-text-faint">
              {new Date(entry.createdAt).toLocaleString()}
              {entry.reason ? ` — ${entry.reason}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
