import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client.js";
import type { RideRequest } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

export function HistoryPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["ride-requests", "history", cursor],
    queryFn: ({ signal }) => api.getPage<RideRequest>(`/ride-requests?limit=10${cursor ? `&cursor=${cursor}` : ""}`, signal),
  });

  if (query.isPending) {
    return (
      <div className="max-w-md animate-pulse space-y-2">
        <div className="h-16 rounded-lg bg-neutral-100" />
        <div className="h-16 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  if (query.isError) {
    return <ErrorBanner message="We can't reach the server. Retry." onRetry={() => void query.refetch()} />;
  }

  if (query.data.data.length === 0 && !cursor) {
    return (
      <div className="max-w-md rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
        No rides yet — Banani traffic awaits.
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-3">
      <h1 className="text-lg font-bold text-neutral-900">Ride history</h1>
      <ul className="space-y-2">
        {query.data.data.map((ride) => (
          <li key={ride.id}>
            <Link
              to={`/p/rides/${ride.id}`}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 hover:border-neutral-300"
            >
              <span>
                <span className="block text-sm font-medium text-neutral-900">
                  {ride.pickupZone} → {ride.dropoffZone}
                </span>
                <span className="block text-xs text-neutral-500">{new Date(ride.createdAt).toLocaleString()}</span>
              </span>
              <span className="text-xs font-medium text-neutral-500">{ride.status.replace("_", " ")}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex justify-between pt-2">
        <button
          type="button"
          disabled={cursorStack.length === 0}
          onClick={() => {
            const stack = [...cursorStack];
            const previous = stack.pop() ?? null;
            setCursorStack(stack);
            setCursor(previous);
          }}
          className="text-sm text-neutral-500 disabled:opacity-40"
        >
          ← Newer
        </button>
        <button
          type="button"
          disabled={!query.data.page.nextCursor}
          onClick={() => {
            if (cursor) setCursorStack([...cursorStack, cursor]);
            setCursor(query.data.page.nextCursor);
          }}
          className="text-sm text-neutral-500 disabled:opacity-40"
        >
          Older →
        </button>
      </div>
    </div>
  );
}
