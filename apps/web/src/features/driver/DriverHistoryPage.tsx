import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api } from "../../lib/api-client.js";
import type { PoolWithEarnings } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

export function DriverHistoryPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["driver", "pools", "history", cursor],
    queryFn: ({ signal }) =>
      api.getPage<PoolWithEarnings>(
        `/driver/pools?limit=10${cursor ? `&cursor=${cursor}` : ""}`,
        signal,
      ),
  });

  if (query.isPending) {
    return (
      <div className="max-w-md space-y-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorBanner
        message="We can't reach the server. Retry."
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (query.data.data.length === 0 && !cursor) {
    return (
      <div className="max-w-md">
        <EmptyState
          icon={Clock}
          title="No pools yet"
          description="Go online to start accepting requests."
        />
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-3">
      <h1 className="font-display text-xl font-bold text-text">Pool history</h1>
      <ul className="space-y-2">
        {query.data.data.map((pool) => (
          <li key={pool.id}>
            <Link to={`/d/pools/${pool.id}`}>
              <Card className="flex items-center justify-between transition-colors hover:border-border-strong">
                <span>
                  <span className="block text-sm font-medium text-text">
                    Pickup: {pool.pickupZone}
                  </span>
                  <span className="block text-xs text-text-faint">
                    {new Date(pool.createdAt).toLocaleString()}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-sm font-semibold text-text">
                    {formatPaisaAsTaka(paisa(pool.earningsPaisa))}
                  </span>
                  <Badge
                    tone={
                      pool.status === "CANCELLED"
                        ? "danger"
                        : pool.status === "COMPLETED"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {pool.status.replace("_", " ").toLowerCase()}
                  </Badge>
                </span>
              </Card>
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
          className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          <ChevronLeft size={15} strokeWidth={2.25} />
          Newer
        </button>
        <button
          type="button"
          disabled={!query.data.page.nextCursor}
          onClick={() => {
            if (cursor) setCursorStack([...cursorStack, cursor]);
            setCursor(query.data.page.nextCursor);
          }}
          className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          Older
          <ChevronRight size={15} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
