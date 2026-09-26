import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Car, Inbox } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, POLL_BASE_MS } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import type { AcceptResult, DriverStatus, RelevantRequest } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { ZonePicker } from "../../components/map/ZonePicker.js";

function GoOnlineForm({
  onGoOnline,
  isPending,
}: {
  onGoOnline: (zone: string) => void;
  isPending: boolean;
}) {
  const zonesQuery = useZones();
  const [zone, setZone] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (zone) onGoOnline(zone);
      }}
    >
      <ZonePicker
        id="current-zone"
        label="Current zone"
        tone="driver"
        value={zone}
        onChange={setZone}
        zones={zonesQuery.data}
        placeholder="Where are you now?"
      />
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

export function DriverDashboardPage() {
  const queryClient = useQueryClient();

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
    return (
      <div className="max-w-md space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <ErrorBanner
        message="We can't reach the server. Retry."
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  const status = statusQuery.data;

  return (
    <div className="max-w-md space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-text">
          {status.name} <span className="text-text-faint">· capacity {status.capacity}</span>
        </h1>
        <Badge tone={status.isOnline ? "success" : "neutral"}>
          {status.isOnline ? "Online" : "Offline"}
        </Badge>
      </div>

      <Card>
        {status.isOnline ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              In zone <span className="font-medium text-text">{status.currentZone}</span>
            </p>
            <Button
              variant="secondary"
              onClick={() => goOffline.mutate()}
              disabled={goOffline.isPending || Boolean(status.activePoolId)}
              title={status.activePoolId ? "Finish or cancel the active pool first" : undefined}
            >
              {goOffline.isPending ? "Going offline…" : "Go offline"}
            </Button>
          </div>
        ) : (
          <GoOnlineForm
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

      {status.activePoolId && (
        <Link to={`/d/pools/${status.activePoolId}`}>
          <Card className="flex items-center justify-between border-accent bg-accent-soft">
            <span className="flex items-center gap-2 text-sm font-medium text-text">
              <Car size={16} strokeWidth={2.25} />
              View active pool
            </span>
            <ArrowRight size={16} strokeWidth={2.25} className="text-text-muted" />
          </Card>
        </Link>
      )}

      {status.isOnline && (
        <div>
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
                description={`Nothing waiting in ${status.currentZone} yet.`}
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
  );
}
