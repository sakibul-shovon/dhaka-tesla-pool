import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ChevronDown, Clock, Search } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import {
  TERMINAL_RIDE_STATUSES,
  type PoolOffer,
  type RideRequest,
  type RideStatusHistoryEntry,
} from "../../lib/types.js";
import { Workspace } from "../../components/layout/Workspace.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { StatusStepper } from "../../components/ui/StatusStepper.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Modal } from "../../components/ui/Modal.js";
import { useToast } from "../../components/ui/Toast.js";

// Lazy everywhere it's used (redesign plan §5/§9) — MapLibre is heavy and
// most authenticated screens never render a map at all.
const ZoneMap = lazy(() =>
  import("../../components/map/ZoneMap.js").then((module) => ({ default: module.ZoneMap })),
);

const CANCELLABLE_STATUSES = new Set(["REQUESTED", "MATCHED", "DRIVER_ARRIVED"]);

// The panel's headline (plan round 3 §3: "big status sentence... 'Looking for
// a Tesla in Banani', 'Jashim has arrived with Bullet'") — one real sentence
// instead of a status enum, built only from data the ride response already
// carries, never invented details like an ETA the backend doesn't compute.
function statusSentence(ride: RideRequest, pickupName: string, dropoffName: string): string {
  switch (ride.status) {
    case "REQUESTED":
      return `Looking for a Tesla in ${pickupName}`;
    case "MATCHED":
      return ride.pool
        ? `${ride.pool.driverFirstName} is heading your way in ${ride.pool.vehicleName}`
        : "You've been matched with a Tesla";
    case "DRIVER_ARRIVED":
      return ride.pool
        ? `${ride.pool.driverFirstName} has arrived with ${ride.pool.vehicleName}`
        : "Your driver has arrived";
    case "STARTED":
      return `On the way to ${dropoffName}`;
    case "COMPLETED":
      return "Trip completed";
    case "CANCELLED":
      return "This ride was cancelled";
  }
}

function OfferRow({ offer, rideId }: { offer: PoolOffer; rideId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [justLostRace, setJustLostRace] = useState(false);
  // One join-intent key per offer row (mirrors the driver dashboard's
  // per-request accept key): joining a *different* pool for the same ride
  // is a genuinely different action, so it must not replay the first pool's
  // cached response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intentKey = useMemo(() => crypto.randomUUID(), [offer.poolId]);

  const join = useMutation({
    mutationFn: () =>
      api.post<RideRequest>(`/pools/${offer.poolId}/join`, { rideRequestId: rideId }, intentKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(["ride-requests", rideId], updated);
    },
    onError: (error) => {
      // Lost the race for this seat, or the offer went stale (plan §15.3)
      // -> refetch the offers list rather than retry the same join. This is
      // the PRD's own "last seat" race, turned into a designed moment
      // instead of a generic error (redesign plan §8.4).
      if (error instanceof ApiError && error.status === 409) {
        setJustLostRace(true);
        showToast({ message: messageForError(error.code, error.message), tone: "warning" });
        void queryClient.invalidateQueries({ queryKey: ["ride-requests", rideId, "pool-offers"] });
      }
    },
  });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <Card className="p-3">
        <motion.div
          animate={justLostRace ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-sm font-medium text-text">
              {offer.vehicleName} · {offer.driverFirstName}
            </p>
            <p className="text-xs text-text-muted">
              {offer.seatsLeft} seat{offer.seatsLeft > 1 ? "s" : ""} left ·{" "}
              {offer.sharedWithCount > 0
                ? `shared with ${offer.sharedWithCount}`
                : "no one aboard yet"}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => join.mutate()}
            disabled={join.isPending}
            className="flex-none"
          >
            {join.isPending ? "Joining…" : "Join"}
          </Button>
        </motion.div>
      </Card>
    </motion.li>
  );
}

function RideSkeleton() {
  return (
    <Workspace
      panel={
        <div className="space-y-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      }
      map={<Skeleton className="h-full w-full rounded-none" />}
    />
  );
}

export function RidePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const zonesQuery = useZones();

  const rideQuery = useQuery({
    queryKey: ["ride-requests", id],
    queryFn: ({ signal }) => api.get<RideRequest>(`/ride-requests/${id}`, signal),
    // A 404 is a definite answer ("no such ride, or not yours"), not a
    // flaky connection, so don't spend the automatic retry on it.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 1,
    refetchInterval: createRefetchInterval<RideRequest>({
      baseMs: POLL_BASE_MS.activeRide,
      isTerminal: (data) => TERMINAL_RIDE_STATUSES.includes(data.status),
    }),
  });

  const historyQuery = useQuery({
    queryKey: ["ride-requests", id, "history"],
    queryFn: ({ signal }) =>
      api.get<RideStatusHistoryEntry[]>(`/ride-requests/${id}/history`, signal),
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
      setConfirmCancelOpen(false);
    },
    onError: (error) => {
      // A 409 means the ride moved on since we last saw it — refetch rather
      // than retry the cancel itself (plan §15.3: "lost the race" -> refetch).
      if (error instanceof ApiError && error.status === 409) {
        setConfirmCancelOpen(false);
        showToast({ message: messageForError(error.code, error.message), tone: "warning" });
        void queryClient.invalidateQueries({ queryKey: ["ride-requests", id] });
      }
    },
  });

  if (rideQuery.isPending) {
    return <RideSkeleton />;
  }

  // The API answers 404 both for an id that doesn't exist and for another
  // passenger's ride (never 403 — that would confirm the ride exists), so
  // this one screen serves both without saying which.
  if (rideQuery.error instanceof ApiError && rideQuery.error.status === 404) {
    return (
      <PageContainer className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Search}
          title={messageForError("NOT_FOUND", "We couldn't find that ride.")}
          description="The link may be wrong, or the ride belongs to someone else."
          action={
            <Link to="/p" className="text-sm font-medium text-accent-strong hover:underline">
              Back to booking
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (rideQuery.isError) {
    const coldStart = isColdStart(rideQuery);
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={coldStart}
          onRetry={() => void rideQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const ride = rideQuery.data;
  const zones = zonesQuery.data ?? [];
  const zoneName = (code: string) => zones.find((zone) => zone.code === code)?.name ?? code;

  return (
    <>
      <Workspace
        panel={
          <div className="flex h-full flex-col">
            <Link
              to="/p"
              className="inline-flex w-fit items-center gap-1 text-sm text-text-muted hover:text-text"
            >
              <ArrowLeft size={15} strokeWidth={2.25} />
              Back
            </Link>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-text-faint">
              {zoneName(ride.pickupZone)} → {zoneName(ride.dropoffZone)}
            </p>
            <h1 className="mt-1 text-balance font-display text-2xl font-bold text-text">
              {statusSentence(ride, zoneName(ride.pickupZone), zoneName(ride.dropoffZone))}
            </h1>

            <div className="mt-5">
              <StatusStepper status={ride.status} />
            </div>

            <div className="mt-5 space-y-4">
              <FareCard
                soloFarePaisa={ride.soloFarePaisa}
                pooledFarePaisa={ride.pooledFarePaisa}
                isFinal={ride.status === "STARTED" || ride.status === "COMPLETED"}
                pooled={(ride.pool?.sharedWithCount ?? 0) > 0}
              />

              {ride.pool && (
                <Card>
                  <p className="text-sm font-medium text-text">
                    {ride.pool.vehicleName} · {ride.pool.driverFirstName}
                  </p>
                  <div className="mt-2">
                    <SeatMeter
                      capacity={ride.pool.capacitySnapshot}
                      reserved={ride.pool.seatsReserved}
                    />
                  </div>
                  <p className="mt-1 text-sm text-text-muted">
                    {ride.pool.sharedWithCount > 0
                      ? `Shared with ${ride.pool.sharedWithCount} other rider${ride.pool.sharedWithCount > 1 ? "s" : ""}`
                      : "No one else aboard yet"}
                  </p>
                </Card>
              )}

              {ride.status === "REQUESTED" && (
                <div>
                  <h2 className="text-sm font-semibold text-text">Nearby Teslas</h2>
                  {offersQuery.isPending ? (
                    <Skeleton className="mt-2 h-16 rounded-xl" />
                  ) : offersQuery.isError ? (
                    <ErrorBanner
                      message="Couldn't load offers."
                      onRetry={() => void offersQuery.refetch()}
                    />
                  ) : offersQuery.data.length === 0 ? (
                    <div className="mt-2">
                      <EmptyState
                        icon={Clock}
                        title="Waiting for a driver in your zone"
                        description="We'll show every compatible Tesla here the moment one opens up nearby."
                      />
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      <AnimatePresence initial={false}>
                        {offersQuery.data.map((offer) => (
                          <OfferRow key={offer.poolId} offer={offer} rideId={ride.id} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              )}

              {CANCELLABLE_STATUSES.has(ride.status) && (
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={() => setConfirmCancelOpen(true)}
                >
                  Cancel ride
                </Button>
              )}

              <details className="group rounded-xl border border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-text">
                  Trip details
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className="text-text-faint transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t border-border px-3.5 py-3">
                  {historyQuery.isPending ? (
                    <Skeleton className="h-16 rounded-lg" />
                  ) : historyQuery.isError ? (
                    <p className="text-sm text-text-muted">Couldn't load the timeline.</p>
                  ) : (
                    <Timeline entries={historyQuery.data} />
                  )}
                </div>
              </details>
            </div>
          </div>
        }
        map={
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <ZoneMap
              className="h-full w-full"
              interactive={false}
              showRoute
              markers={[
                { zoneCode: ride.pickupZone, label: zoneName(ride.pickupZone), tone: "pickup" },
                { zoneCode: ride.dropoffZone, label: zoneName(ride.dropoffZone), tone: "dropoff" },
              ]}
            />
          </Suspense>
        }
      />

      <Modal
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Cancel this ride?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Cancel ride"}
            </Button>
          </>
        }
      >
        <p>
          {zoneName(ride.pickupZone)} → {zoneName(ride.dropoffZone)} will be cancelled. This can't
          be undone.
        </p>
        {cancel.isError && (
          <p className="mt-2 text-sm text-danger">
            {cancel.error instanceof ApiError
              ? messageForError(cancel.error.code, cancel.error.message)
              : "Something went wrong."}
          </p>
        )}
      </Modal>
    </>
  );
}
