import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { TERMINAL_RIDE_STATUSES, type RideRequest, type RideStatusHistoryEntry } from "../../lib/types.js";
import { StatusStepper } from "../../components/ui/StatusStepper.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

const CANCELLABLE_STATUSES = new Set(["REQUESTED", "MATCHED", "DRIVER_ARRIVED"]);

export function RidePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const rideQuery = useQuery({
    queryKey: ["ride-requests", id],
    queryFn: ({ signal }) => api.get<RideRequest>(`/ride-requests/${id}`, signal),
    refetchInterval: createRefetchInterval<RideRequest>({
      baseMs: POLL_BASE_MS.activeRide,
      isTerminal: (data) => TERMINAL_RIDE_STATUSES.includes(data.status),
    }),
  });

  const historyQuery = useQuery({
    queryKey: ["ride-requests", id, "history"],
    queryFn: ({ signal }) => api.get<RideStatusHistoryEntry[]>(`/ride-requests/${id}/history`, signal),
  });

  const rideStatus = rideQuery.data?.status;
  useEffect(() => {
    if (rideStatus) {
      void queryClient.invalidateQueries({ queryKey: ["ride-requests", id, "history"] });
    }
    // Only re-run when the ride actually *transitions*, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideStatus]);

  // Regenerated per ride / per status change on purpose (plan §11) — the
  // deps drive that, the callback body doesn't read them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cancelIntentKey = useMemo(() => crypto.randomUUID(), [id, rideStatus]);
  const cancel = useMutation({
    mutationFn: () => api.post<RideRequest>(`/ride-requests/${id}/cancel`, {}, cancelIntentKey),
    onSuccess: (ride) => {
      queryClient.setQueryData(["ride-requests", id], ride);
    },
    onError: (error) => {
      // A 409 means the ride moved on since we last saw it — refetch rather
      // than retry the cancel itself (plan §15.3: "lost the race" -> refetch).
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["ride-requests", id] });
      }
    },
  });

  if (rideQuery.isPending) {
    return <div className="h-40 max-w-md animate-pulse rounded-lg bg-neutral-100" />;
  }

  if (rideQuery.isError) {
    const coldStart = isColdStart(rideQuery as never);
    return (
      <ErrorBanner
        message="We can't reach the server. Retry."
        coldStart={coldStart}
        onRetry={() => void rideQuery.refetch()}
      />
    );
  }

  const ride = rideQuery.data;

  return (
    <div className="max-w-md space-y-4">
      <Link to="/p" className="text-sm text-neutral-500 hover:text-neutral-700">
        ← Back
      </Link>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <p className="text-lg font-semibold text-neutral-900">
          {ride.pickupZone} → {ride.dropoffZone}
        </p>
        <div className="mt-4">
          <StatusStepper status={ride.status} />
        </div>
      </div>

      <FareCard
        soloFarePaisa={ride.soloFarePaisa}
        pooledFarePaisa={ride.pooledFarePaisa}
        isFinal={ride.status === "STARTED" || ride.status === "COMPLETED"}
      />

      {cancel.isError && (
        <ErrorBanner
          message={
            cancel.error instanceof ApiError
              ? messageForError(cancel.error.code, cancel.error.message)
              : "Something went wrong."
          }
        />
      )}

      {CANCELLABLE_STATUSES.has(ride.status) && (
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="w-full rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {cancel.isPending ? "Cancelling…" : "Cancel ride"}
        </button>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Timeline</h2>
        <div className="mt-3">
          {historyQuery.isPending ? (
            <div className="h-16 animate-pulse rounded bg-neutral-100" />
          ) : historyQuery.isError ? (
            <p className="text-sm text-neutral-500">Couldn't load the timeline.</p>
          ) : (
            <Timeline entries={historyQuery.data} />
          )}
        </div>
      </div>
    </div>
  );
}
