import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, POLL_BASE_MS } from "../../lib/polling.js";
import type { AcceptResult, DriverStatus, RelevantRequest, Zone } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

function GoOnlineForm({ onGoOnline, isPending }: { onGoOnline: (zone: string) => void; isPending: boolean }) {
  const [zone, setZone] = useState("");
  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: ({ signal }) => api.get<Zone[]>("/zones", signal) });

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (zone) onGoOnline(zone);
      }}
    >
      <select
        required
        value={zone}
        onChange={(event) => setZone(event.target.value)}
        className="rounded border border-neutral-300 px-3 py-2 text-sm"
      >
        <option value="" disabled>
          Current zone
        </option>
        {(zonesQuery.data ?? []).map((z) => (
          <option key={z.code} value={z.code}>
            {z.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending || !zone}
        className="rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isPending ? "Going online…" : "Go online"}
      </button>
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
    mutationFn: () => api.post<AcceptResult>(`/driver/requests/${request.id}/accept`, {}, intentKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver", "status"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "requests"] });
    },
  });

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">
            {request.pickupZone} → {request.dropoffZone}
          </p>
          <p className="text-xs text-neutral-500">
            {request.seats} seat{request.seats > 1 ? "s" : ""} · {(request.distanceDkm / 10).toFixed(1)} km
          </p>
        </div>
        <button
          type="button"
          onClick={() => accept.mutate()}
          disabled={accept.isPending}
          className="flex-none rounded bg-[--color-accent] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {accept.isPending ? "Accepting…" : "Accept"}
        </button>
      </div>
      {accept.isError && (
        <p className="mt-2 text-xs text-red-600">
          {accept.error instanceof ApiError ? messageForError(accept.error.code, accept.error.message) : "Something went wrong."}
        </p>
      )}
    </li>
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
    return <div className="h-40 max-w-md animate-pulse rounded-lg bg-neutral-100" />;
  }

  if (statusQuery.isError) {
    return (
      <ErrorBanner message="We can't reach the server. Retry." onRetry={() => void statusQuery.refetch()} />
    );
  }

  const status = statusQuery.data;

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">
        {status.name} · capacity {status.capacity}
      </h1>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        {status.isOnline ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-700">
              Online in <span className="font-medium">{status.currentZone}</span>
            </p>
            <button
              type="button"
              onClick={() => goOffline.mutate()}
              disabled={goOffline.isPending || Boolean(status.activePoolId)}
              title={status.activePoolId ? "Finish or cancel the active pool first" : undefined}
              className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-40"
            >
              {goOffline.isPending ? "Going offline…" : "Go offline"}
            </button>
          </div>
        ) : (
          <GoOnlineForm onGoOnline={(zone) => goOnline.mutate(zone)} isPending={goOnline.isPending} />
        )}
        {(goOnline.isError || goOffline.isError) && (
          <p className="mt-2 text-sm text-red-600">
            {(() => {
              const error = goOnline.error ?? goOffline.error;
              return error instanceof ApiError ? messageForError(error.code, error.message) : "Something went wrong.";
            })()}
          </p>
        )}
      </div>

      {status.activePoolId && (
        <Link
          to={`/d/pools/${status.activePoolId}`}
          className="block rounded-lg border border-[--color-accent] bg-[--color-accent-light] p-4 text-sm font-medium text-neutral-900"
        >
          View active pool →
        </Link>
      )}

      {status.isOnline && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Nearby requests</h2>
          {requestsQuery.isPending ? (
            <div className="mt-2 h-16 animate-pulse rounded-lg bg-neutral-100" />
          ) : requestsQuery.isError ? (
            <ErrorBanner message="Couldn't load requests." onRetry={() => void requestsQuery.refetch()} />
          ) : requestsQuery.data.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No requests in {status.currentZone} right now.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {requestsQuery.data.map((request) => (
                <RequestRow key={request.id} request={request} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
