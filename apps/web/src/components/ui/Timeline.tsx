const STATUS_LABELS: Record<string, string> = {
  OPEN: "Pool opened",
  REQUESTED: "Requested",
  MATCHED: "Matched with a Tesla",
  DRIVER_ARRIVED: "Driver arrived",
  STARTED: "Trip started",
  COMPLETED: "Trip completed",
  CANCELLED: "Cancelled",
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
    return <p className="text-sm text-neutral-500">No history yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3 text-sm">
          <span className="mt-1 h-2 w-2 flex-none rounded-full bg-[--color-accent]" aria-hidden />
          <div>
            <p className="font-medium text-neutral-900">{STATUS_LABELS[entry.toStatus] ?? entry.toStatus}</p>
            <p className="text-neutral-500">
              {new Date(entry.createdAt).toLocaleString()}
              {entry.reason ? ` — ${entry.reason}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
