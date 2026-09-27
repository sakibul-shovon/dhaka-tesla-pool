import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { RideRequest, RideStatus } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

const STATUS_FILTERS: { value: RideStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "REQUESTED", label: "Requested" },
  { value: "MATCHED", label: "Matched" },
  { value: "DRIVER_ARRIVED", label: "Driver arrived" },
  { value: "STARTED", label: "Started" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

function statusTone(status: RideStatus): "danger" | "success" | "neutral" {
  if (status === "CANCELLED") return "danger";
  if (status === "COMPLETED") return "success";
  return "neutral";
}

// The fare that actually applies to this ride right now: the pooled rate
// once someone has shared it, the solo quote otherwise — same rule FareCard
// uses on the live ride/booking screens (plan §8).
function fareFor(ride: RideRequest): number {
  return (ride.pool?.sharedWithCount ?? 0) > 0 ? ride.pooledFarePaisa : ride.soloFarePaisa;
}

export function HistoryPage() {
  const [statusFilter, setStatusFilter] = useState<RideStatus | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["ride-requests", "history", statusFilter, cursor],
    queryFn: ({ signal }) =>
      api.getPage<RideRequest>(
        `/ride-requests?limit=10${statusFilter ? `&status=${statusFilter}` : ""}${cursor ? `&cursor=${cursor}` : ""}`,
        signal,
      ),
  });

  function selectFilter(value: RideStatus | null) {
    setStatusFilter(value);
    setCursor(null);
    setCursorStack([]);
  }

  const filters = (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {STATUS_FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          onClick={() => selectFilter(filter.value)}
          className={
            "flex-none rounded-full border px-3 py-1.5 text-sm font-medium transition-colors " +
            (statusFilter === filter.value
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-border-strong text-text-muted hover:text-text")
          }
        >
          {filter.label}
        </button>
      ))}
    </div>
  );

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-text">Ride history</h1>
      </div>
      <div className="mt-4">{filters}</div>

      <div className="mt-5">
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : query.isError ? (
          <ErrorBanner
            message="We can't reach the server. Retry."
            coldStart={isColdStart(query as never)}
            onRetry={() => void query.refetch()}
          />
        ) : query.data.data.length === 0 ? (
          statusFilter ? (
            <EmptyState
              icon={Clock}
              title={`No ${STATUS_FILTERS.find((filter) => filter.value === statusFilter)?.label.toLowerCase()} rides`}
              description="Try a different filter."
              action={
                <button
                  type="button"
                  onClick={() => selectFilter(null)}
                  className="text-sm font-medium text-accent-strong hover:underline"
                >
                  Clear filter
                </button>
              }
            />
          ) : (
            <EmptyState icon={Clock} title="No rides yet" description="Banani traffic awaits." />
          )
        ) : (
          <>
            {/* Desktop: table-style rows (plan round 3 §3). */}
            <div className="hidden overflow-hidden rounded-2xl border border-border sm:block">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-6 border-b border-border bg-surface-raised px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-text-faint">
                <span>Route</span>
                <span>Date</span>
                <span>Status</span>
                <span className="text-right">Fare</span>
              </div>
              <div className="divide-y divide-border bg-surface">
                {query.data.data.map((ride) => (
                  <Link
                    key={ride.id}
                    to={`/p/rides/${ride.id}`}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 px-4 py-3 text-sm transition-colors hover:bg-surface-raised"
                  >
                    <span className="font-medium text-text">
                      {ride.pickupZone} → {ride.dropoffZone}
                    </span>
                    <span className="text-text-muted">
                      {new Date(ride.createdAt).toLocaleDateString()}
                    </span>
                    <Badge tone={statusTone(ride.status)}>
                      {ride.status.replace("_", " ").toLowerCase()}
                    </Badge>
                    <span className="tabular text-right font-medium text-text">
                      {formatPaisaAsTaka(paisa(fareFor(ride)))}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Mobile: cards. */}
            <ul className="space-y-2 sm:hidden">
              {query.data.data.map((ride) => (
                <li key={ride.id}>
                  <Link to={`/p/rides/${ride.id}`}>
                    <Card className="transition-[color,background-color,border-color,box-shadow,transform] hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text">
                          {ride.pickupZone} → {ride.dropoffZone}
                        </span>
                        <Badge tone={statusTone(ride.status)}>
                          {ride.status.replace("_", " ").toLowerCase()}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-xs text-text-faint">
                          {new Date(ride.createdAt).toLocaleString()}
                        </span>
                        <span className="tabular text-sm font-medium text-text">
                          {formatPaisaAsTaka(paisa(fareFor(ride)))}
                        </span>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {query.data && query.data.data.length > 0 && (
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
        )}
      </div>
    </PageContainer>
  );
}
