import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api } from "../../lib/api-client.js";
import type { PoolWithEarnings } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

export function DriverHistoryPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["driver", "pools", "history", cursor],
    queryFn: ({ signal }) => api.getPage<PoolWithEarnings>(`/driver/pools?limit=10${cursor ? `&cursor=${cursor}` : ""}`, signal),
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
        No pools yet — go online to start accepting requests.
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-3">
      <h1 className="text-lg font-bold text-neutral-900">Pool history</h1>
      <ul className="space-y-2">
        {query.data.data.map((pool) => (
          <li key={pool.id}>
            <Link
              to={`/d/pools/${pool.id}`}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 hover:border-neutral-300"
            >
              <span>
                <span className="block text-sm font-medium text-neutral-900">Pickup: {pool.pickupZone}</span>
                <span className="block text-xs text-neutral-500">{new Date(pool.createdAt).toLocaleString()}</span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold text-neutral-900">
                  {formatPaisaAsTaka(paisa(pool.earningsPaisa))}
                </span>
                <span className="block text-xs text-neutral-500">{pool.status.replace("_", " ")}</span>
              </span>
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
