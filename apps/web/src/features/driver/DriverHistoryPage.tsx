import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { PoolStatus, PoolWithEarnings } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

function statusTone(status: PoolStatus): "danger" | "success" | "neutral" {
  if (status === "CANCELLED") return "danger";
  if (status === "COMPLETED") return "success";
  return "neutral";
}

// Note: unlike the passenger ride history, `GET /driver/pools` has no
// `?status=` filter to build chips on top of (plan round 3's "existing API
// support" only covers the passenger endpoint) — this stays a plain list.
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
      <PageContainer>
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError) {
    return (
      <PageContainer>
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(query as never)}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  if (query.data.data.length === 0 && !cursor) {
    return (
      <PageContainer>
        <h1 className="font-display text-2xl font-bold text-text">Pool history</h1>
        <div className="mt-5">
          <EmptyState
            icon={Clock}
            title="No pools yet"
            description="Go online to start accepting requests."
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <h1 className="font-display text-2xl font-bold text-text">Pool history</h1>

      <div className="mt-5">
        {/* Desktop: table-style rows (plan round 3 §3). */}
        <div className="hidden overflow-hidden rounded-2xl border border-border sm:block">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-6 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-text-faint">
            <span>Pickup</span>
            <span>Date</span>
            <span>Status</span>
            <span className="text-right">Earnings</span>
          </div>
          <div className="divide-y divide-border bg-surface">
            {query.data.data.map((pool) => (
              <Link
                key={pool.id}
                to={`/d/pools/${pool.id}`}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 px-4 py-3 text-sm transition-colors hover:bg-surface-raised"
              >
                <span className="font-medium text-text">{pool.pickupZone}</span>
                <span className="text-text-muted">
                  {new Date(pool.createdAt).toLocaleDateString()}
                </span>
                <Badge tone={statusTone(pool.status)}>
                  {pool.status.replace("_", " ").toLowerCase()}
                </Badge>
                <span className="tabular text-right font-medium text-text">
                  {formatPaisaAsTaka(paisa(pool.earningsPaisa))}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Mobile: cards. */}
        <ul className="space-y-2 sm:hidden">
          {query.data.data.map((pool) => (
            <li key={pool.id}>
              <Link to={`/d/pools/${pool.id}`}>
                <Card className="transition-[color,background-color,border-color,box-shadow,transform] hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">Pickup: {pool.pickupZone}</span>
                    <Badge tone={statusTone(pool.status)}>
                      {pool.status.replace("_", " ").toLowerCase()}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-text-faint">
                      {new Date(pool.createdAt).toLocaleString()}
                    </span>
                    <span className="tabular text-sm font-medium text-text">
                      {formatPaisaAsTaka(paisa(pool.earningsPaisa))}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-between">
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
    </PageContainer>
  );
}
