import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { TERMINAL_RIDE_STATUSES, type PoolOffer, type RideRequest, type RideStatusHistoryEntry } from "../../lib/types.js";
import { StatusStepper } from "../../components/ui/StatusStepper.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

const CANCELLABLE_STATUSES = new Set(["REQUESTED", "MATCHED", "DRIVER_ARRIVED"]);

function OfferRow({ offer, rideId }: { offer: PoolOffer; rideId: string }) {
  const queryClient = useQueryClient();
  // One join-intent key per offer row (mirrors the driver dashboard's
  // per-request accept key): joining a *different* pool for the same ride
  // is a genuinely different action, so it must not replay the first pool's
  // cached response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intentKey = useMemo(() => crypto.randomUUID(), [offer.poolId]);

  const join = useMutation({
    mutationFn: () => api.post<RideRequest>(`/pools/${offer.poolId}/join`, { rideRequestId: rideId }, intentKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(["ride-requests", rideId], updated);
    },
    onError: (error) => {
      // Lost the race for this seat, or the offer went stale (plan §15.3)
      // -> refetch the offers list rather than retry the same join.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["ride-requests", rideId, "pool-offers"] });
      }
    },
  });

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">
            {offer.vehicleName} · {offer.driverFirstName}
          </p>
          <p className="text-xs text-neutral-500">
            {offer.seatsLeft} seat{offer.seatsLeft > 1 ? "s" : ""} left ·{" "}
            {offer.sharedWithCount > 0 ? `shared with ${offer.sharedWithCount}` : "no one aboard yet"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => join.mutate()}
          disabled={join.isPending}
          className="flex-none rounded bg-[--color-accent] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {join.isPending ? "Joining…" : "Join"}
        </button>
      </div>
      {join.isError && (
        <p className="mt-2 text-xs text-red-600">
          {join.error instanceof ApiError ? messageForError(join.error.code, join.error.message) : "Something went wrong."}
        </p>
      )}
    </li>
  );
}

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

  const offersQuery = useQuery({
    queryKey: ["ride-requests", id, "pool-offers"],
    queryFn: ({ signal }) => api.get<PoolOffer[]>(`/ride-requests/${id}/pool-offers`, signal),
    enabled: rideStatus === "REQUESTED",
    refetchInterval: createRefetchInterval<PoolOffer[]>({
      baseMs: POLL_BASE_MS.activeRide,
      isTerminal: () => false,
    }),
  });

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

      {ride.pool && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm font-medium text-neutral-900">
            {ride.pool.vehicleName} · {ride.pool.driverFirstName}
          </p>
          <div className="mt-2">
            <SeatMeter capacity={ride.pool.capacitySnapshot} reserved={ride.pool.seatsReserved} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {ride.pool.sharedWithCount > 0
              ? `Shared with ${ride.pool.sharedWithCount} other rider${ride.pool.sharedWithCount > 1 ? "s" : ""}`
              : "No one else aboard yet"}
          </p>
        </div>
      )}

      <FareCard
        soloFarePaisa={ride.soloFarePaisa}
        pooledFarePaisa={ride.pooledFarePaisa}
        isFinal={ride.status === "STARTED" || ride.status === "COMPLETED"}
        pooled={(ride.pool?.sharedWithCount ?? 0) > 0}
      />

      {ride.status === "REQUESTED" && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Nearby Teslas</h2>
          {offersQuery.isPending ? (
            <div className="mt-2 h-16 animate-pulse rounded-lg bg-neutral-100" />
          ) : offersQuery.isError ? (
            <ErrorBanner message="Couldn't load offers." onRetry={() => void offersQuery.refetch()} />
          ) : offersQuery.data.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No open Teslas in your zone yet — waiting for a driver.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {offersQuery.data.map((offer) => (
                <OfferRow key={offer.poolId} offer={offer} rideId={ride.id} />
              ))}
            </ul>
          )}
        </div>
      )}

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
