import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Car, Inbox } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import type { AcceptResult, DriverStatus, RelevantRequest } from "../../lib/types.js";
import { Workspace } from "../../components/layout/Workspace.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Select } from "../../components/ui/Select.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

// Lazy: this page's offline state never renders a map marker until a zone is
// picked, and the skeleton state never needs it at all (plan §5/§9).
const ZoneMap = lazy(() =>
  import("../../components/map/ZoneMap.js").then((module) => ({ default: module.ZoneMap })),
);

function GoOnlineForm({
  zone,
  onZoneChange,
  onGoOnline,
  isPending,
}: {
  zone: string;
  onZoneChange: (zone: string) => void;
  onGoOnline: (zone: string) => void;
  isPending: boolean;
}) {
  const zonesQuery = useZones();
  const zones = zonesQuery.data ?? [];

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (zone) onGoOnline(zone);
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="current-zone" className="block text-sm font-medium text-text">
          Current zone
        </label>
        <Select
          id="current-zone"
          value={zone}
          onChange={(event) => onZoneChange(event.target.value)}
          required
        >
          <option value="" disabled>
            Where are you now?
          </option>
          {zones.map((z) => (
            <option key={z.code} value={z.code}>
              {z.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={isPending || !zone} className="w-full">
        {isPending ? "Going online…" : "Go online"}
      </Button>
    </form>
  );
}

function RequestRow({ request }: { request: RelevantRequest }) {
  const queryClient = useQueryClient();
  // One accept-intent key per request row (plan §11); regenerated only if
  // the row's request id itself changes, not read by the callback body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intentKey = useMemo(() => crypto.randomUUID(), [request.id]);

  const accept = useMutation({
    mutationFn: () =>
      api.post<AcceptResult>(`/driver/requests/${request.id}/accept`, {}, intentKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver", "status"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "requests"] });
    },
  });

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text">
            {request.pickupZone} → {request.dropoffZone}
          </p>
          <p className="text-xs text-text-muted">
            {request.seats} seat{request.seats > 1 ? "s" : ""} ·{" "}
            {(request.distanceDkm / 10).toFixed(1)} km
          </p>
        </div>
        <Button onClick={() => accept.mutate()} disabled={accept.isPending} className="flex-none">
          {accept.isPending ? "Accepting…" : "Accept"}
        </Button>
      </div>
      {accept.isError && (
        <p className="mt-2 text-xs text-danger">
          {accept.error instanceof ApiError
            ? messageForError(accept.error.code, accept.error.message)
            : "Something went wrong."}
        </p>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <Workspace
      panel={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      }
      map={<Skeleton className="h-full w-full rounded-none" />}
    />
  );
}

export function DriverDashboardPage() {
  const queryClient = useQueryClient();
  const zonesQuery = useZones();
  // The zone a still-offline driver is choosing — lives here (not inside
  // GoOnlineForm) so the workspace map can preview it live, the same pattern
  // the booking page uses for its route pins.
  const [pendingZone, setPendingZone] = useState("");

  const statusQuery = useQuery({
    queryKey: ["driver", "status"],
    queryFn: ({ signal }) => api.get<DriverStatus>("/driver/status", signal),
  });

  const goOnline = useMutation({
    mutationFn: (zone: string) => api.post<DriverStatus>("/driver/go-online", { zone }),
    onSuccess: (status) => queryClient.setQueryData(["driver", "status"], status),
  });

  const goOffline = useMutation({
    mutationFn: () => api.post<DriverStatus>("/driver/go-offline"),
    onSuccess: (status) => queryClient.setQueryData(["driver", "status"], status),
  });

  const isOnline = statusQuery.data?.isOnline ?? false;
  const requestsQuery = useQuery({
    queryKey: ["driver", "requests"],
    queryFn: ({ signal }) => api.get<RelevantRequest[]>("/driver/requests", signal),
    enabled: isOnline,
    refetchInterval: createRefetchInterval<RelevantRequest[]>({
      baseMs: POLL_BASE_MS.driverPoll,
      isTerminal: () => false,
    }),
  });

  if (statusQuery.isPending) {
    return <DashboardSkeleton />;
  }

  if (statusQuery.isError) {
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(statusQuery as never)}
          onRetry={() => void statusQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const status = statusQuery.data;
  const zones = zonesQuery.data ?? [];
  const zoneName = (code: string) => zones.find((zone) => zone.code === code)?.name ?? code;

  // Online: the driver's own zone plus where each visible request would end
  // (deduped) — the same "anchor + dropoffs" shape as the active-pool map, so
  // the visual language stays consistent across the driver's whole session.
  // Offline: just a live preview of the zone being chosen.
  const mapMarkers = status.isOnline
    ? [
        ...(status.currentZone
          ? [
              {
                zoneCode: status.currentZone,
                label: zoneName(status.currentZone),
                tone: "driver" as const,
              },
            ]
          : []),
        ...[...new Set((requestsQuery.data ?? []).map((request) => request.dropoffZone))].map(
          (code) => ({ zoneCode: code, label: zoneName(code), tone: "dropoff" as const }),
        ),
      ]
    : pendingZone
      ? [{ zoneCode: pendingZone, label: zoneName(pendingZone), tone: "driver" as const }]
      : [];

  return (
    <Workspace
      panel={
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-bold text-text">
              {status.name} <span className="text-text-faint">· capacity {status.capacity}</span>
            </h1>
            <Badge tone={status.isOnline ? "success" : "neutral"}>
              {status.isOnline ? "Online" : "Offline"}
            </Badge>
          </div>

          <div className="mt-5">
            <Card>
              {status.isOnline ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-muted">
                    In zone{" "}
                    <span className="font-medium text-text">
                      {status.currentZone ? zoneName(status.currentZone) : "—"}
                    </span>
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => goOffline.mutate()}
                    disabled={goOffline.isPending || Boolean(status.activePoolId)}
                    title={
                      status.activePoolId ? "Finish or cancel the active pool first" : undefined
                    }
                  >
                    {goOffline.isPending ? "Going offline…" : "Go offline"}
                  </Button>
                </div>
              ) : (
                <GoOnlineForm
                  zone={pendingZone}
                  onZoneChange={setPendingZone}
                  onGoOnline={(zone) => goOnline.mutate(zone)}
                  isPending={goOnline.isPending}
                />
              )}
              {(goOnline.isError || goOffline.isError) && (
                <p className="mt-2 text-sm text-danger">
                  {(() => {
                    const error = goOnline.error ?? goOffline.error;
                    return error instanceof ApiError
                      ? messageForError(error.code, error.message)
                      : "Something went wrong.";
                  })()}
                </p>
              )}
            </Card>
          </div>

          {status.activePoolId && (
            <div className="mt-4">
              <Link to={`/d/pools/${status.activePoolId}`}>
                <Card className="flex items-center justify-between border-accent bg-accent-soft">
                  <span className="flex items-center gap-2 text-sm font-medium text-text">
                    <Car size={16} strokeWidth={2.25} />
                    View active pool
                  </span>
                  <ArrowRight size={16} strokeWidth={2.25} className="text-text-muted" />
                </Card>
              </Link>
            </div>
          )}

          {status.isOnline && (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-text">Nearby requests</h2>
              {requestsQuery.isPending ? (
                <Skeleton className="mt-2 h-16 rounded-xl" />
              ) : requestsQuery.isError ? (
                <ErrorBanner
                  message="Couldn't load requests."
                  onRetry={() => void requestsQuery.refetch()}
                />
              ) : requestsQuery.data.length === 0 ? (
                <div className="mt-2">
                  <EmptyState
                    icon={Inbox}
                    title="No requests right now"
                    description={`Nothing waiting in ${status.currentZone ? zoneName(status.currentZone) : "your zone"} yet.`}
                  />
                </div>
              ) : (
                <ul className="mt-2 space-y-2">
                  {requestsQuery.data.map((request) => (
                    <li key={request.id}>
                      <RequestRow request={request} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      }
      map={
        <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
          <ZoneMap className="h-full w-full" markers={mapMarkers} showRoute={false} />
        </Suspense>
      }
    />
  );
}
