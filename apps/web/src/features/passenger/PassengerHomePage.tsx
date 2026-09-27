import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Banknote, Minus, Plus, Wallet as WalletIcon } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import { clearQuickTrip, peekQuickTrip } from "../../lib/quickTrip.js";
import {
  ACTIVE_RIDE_STATUSES,
  type FareQuote,
  type RideRequest,
  type WalletSummary,
  type Zone,
} from "../../lib/types.js";
import { Workspace } from "../../components/layout/Workspace.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { RouteFields } from "../../components/map/RouteFields.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

// Lazy everywhere it's used (plan §5/§9) — the booking form's empty state
// never needs it at all.
const ZoneMap = lazy(() =>
  import("../../components/map/ZoneMap.js").then((module) => ({ default: module.ZoneMap })),
);

const SEAT_MIN = 1;
const SEAT_MAX = 3;

// Shown instead of the form when a passenger with an existing active ride
// lands on `/p` directly (nav link, refresh). Uses the same Workspace shape
// as the rest of this page and RidePage — a lone centred card on an empty
// canvas was exactly the "too much dead space" problem round 3 set out to
// fix, so this gets the real map too rather than a bare summary.
function ActiveRideCard({ ride, zones }: { ride: RideRequest; zones: Zone[] }) {
  const zoneName = (code: string) => zones.find((zone) => zone.code === code)?.name ?? code;

  return (
    <Workspace
      panel={
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-text-faint">
              Active ride
            </p>
            <Badge tone="accent">{ride.status.replace("_", " ").toLowerCase()}</Badge>
          </div>
          <h1 className="mt-2 text-balance font-display text-2xl font-bold text-text">
            {zoneName(ride.pickupZone)} → {zoneName(ride.dropoffZone)}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            You already have a ride in progress — you can only request one at a time.
          </p>
          <Link to={`/p/rides/${ride.id}`}>
            <Button className="mt-5 w-full">View ride</Button>
          </Link>
        </motion.div>
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
  );
}

function HomeSkeleton() {
  return (
    <Workspace
      panel={
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      }
      map={<Skeleton className="h-full w-full rounded-none" />}
    />
  );
}

export function PassengerHomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const zonesQuery = useZones();
  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: ({ signal }) => api.get<WalletSummary>("/wallet", signal),
  });
  // A passenger can have at most one active ride (plan §5.2) — the most
  // recent page is always enough to find it if one exists.
  const recentRidesQuery = useQuery({
    queryKey: ["ride-requests", "recent"],
    queryFn: ({ signal }) => api.getPage<RideRequest>("/ride-requests?limit=5", signal),
  });

  // A route chosen on the landing page's quick-trip widget (sessionStorage,
  // best-effort) prefills these two fields exactly once. `peekQuickTrip` is a
  // pure read, safe under Strict Mode's double-invoked lazy initializers; the
  // effect below clears it so a later visit to `/p` doesn't resurface it.
  const [initialTrip] = useState(() => peekQuickTrip());
  const [pickupZone, setPickupZone] = useState(initialTrip?.pickup ?? "");
  const [dropoffZone, setDropoffZone] = useState(initialTrip?.dropoff ?? "");
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TESLAPAY">("CASH");

  useEffect(() => {
    if (initialTrip) clearQuickTrip();
    // Only ever meaningful on the mount that carried a quick-trip value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quoteEnabled = Boolean(pickupZone) && Boolean(dropoffZone) && pickupZone !== dropoffZone;
  const quoteQuery = useQuery({
    queryKey: ["fare-quote", pickupZone, dropoffZone, seats],
    queryFn: () => api.post<FareQuote>("/fare-quotes", { pickupZone, dropoffZone, seats }),
    enabled: quoteEnabled,
    retry: false,
  });

  // One key per submission intent, regenerated only when the trip inputs
  // change — a retry of the *same* attempt (network hiccup, double click)
  // must reuse it, or the server sees two different requests (plan §11).
  // The deps intentionally drive regeneration without being read in the body;
  // a block disable (not eslint-disable-next-line) because prettier wraps
  // this call across multiple lines once there are four dependencies.
  /* eslint-disable react-hooks/exhaustive-deps */
  const intentKey = useMemo(
    () => crypto.randomUUID(),
    [pickupZone, dropoffZone, seats, paymentMethod],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  const createRide = useMutation({
    mutationFn: () =>
      api.post<RideRequest>(
        "/ride-requests",
        { pickupZone, dropoffZone, seats, paymentMethod },
        intentKey,
      ),
    onSuccess: (ride) => {
      queryClient.invalidateQueries({ queryKey: ["ride-requests"] });
      navigate(`/p/rides/${ride.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createRide.mutate();
  }

  if (recentRidesQuery.isPending || zonesQuery.isPending) {
    return <HomeSkeleton />;
  }

  if (recentRidesQuery.isError || zonesQuery.isError) {
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(recentRidesQuery as never) || isColdStart(zonesQuery as never)}
          onRetry={() => {
            void recentRidesQuery.refetch();
            void zonesQuery.refetch();
          }}
        />
      </PageContainer>
    );
  }

  const zones = zonesQuery.data;

  const activeRide = recentRidesQuery.data.data.find((ride) =>
    ACTIVE_RIDE_STATUSES.includes(ride.status),
  );
  if (activeRide) {
    return <ActiveRideCard ride={activeRide} zones={zones} />;
  }

  const balance = walletQuery.data?.balancePaisa;

  const zoneName = (code: string) => zones.find((zone) => zone.code === code)?.name ?? code;
  const mapMarkers = [
    ...(pickupZone
      ? [{ zoneCode: pickupZone, label: zoneName(pickupZone), tone: "pickup" as const }]
      : []),
    ...(dropoffZone && dropoffZone !== pickupZone
      ? [{ zoneCode: dropoffZone, label: zoneName(dropoffZone), tone: "dropoff" as const }]
      : []),
  ];

  return (
    <Workspace
      panel={
        <div className="flex h-full flex-col">
          <h1 className="font-display text-xl font-bold text-text">Request a ride</h1>
          <p className="mt-1 text-sm text-text-muted">
            Pick your route — we'll show your fare before you request.
          </p>

          <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
            <RouteFields
              zones={zones}
              pickup={pickupZone}
              dropoff={dropoffZone}
              onPickupChange={setPickupZone}
              onDropoffChange={setDropoffZone}
            />
            {pickupZone && dropoffZone && pickupZone === dropoffZone && (
              <p className="text-sm text-danger">Pickup and drop-off must be different.</p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text">Seats</label>
                <div className="mt-1.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSeats((current) => Math.max(SEAT_MIN, current - 1))}
                    disabled={seats <= SEAT_MIN}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-text transition-colors hover:border-accent hover:text-accent-strong disabled:opacity-30"
                    aria-label="Fewer seats"
                  >
                    <Minus size={15} strokeWidth={2.5} />
                  </button>
                  <span className="tabular w-5 text-center font-display text-base font-semibold text-text">
                    {seats}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSeats((current) => Math.min(SEAT_MAX, current + 1))}
                    disabled={seats >= SEAT_MAX}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong text-text transition-colors hover:border-accent hover:text-accent-strong disabled:opacity-30"
                    aria-label="More seats"
                  >
                    <Plus size={15} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text">Payment</label>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("CASH")}
                    className={
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors " +
                      (paymentMethod === "CASH"
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-border-strong text-text-muted hover:text-text")
                    }
                  >
                    <Banknote size={14} strokeWidth={2.25} />
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("TESLAPAY")}
                    className={
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors " +
                      (paymentMethod === "TESLAPAY"
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-border-strong text-text-muted hover:text-text")
                    }
                  >
                    <WalletIcon size={14} strokeWidth={2.25} />
                    TeslaPay
                    {typeof balance === "number" ? ` · ${formatPaisaAsTaka(paisa(balance))}` : ""}
                  </button>
                </div>
              </div>
            </div>

            {quoteEnabled && quoteQuery.isPending && <Skeleton className="h-24" />}
            {quoteEnabled && quoteQuery.isError && (
              <p className="text-sm text-danger">Couldn't get a quote — try again.</p>
            )}
            {quoteQuery.data && (
              <motion.div
                key={`${pickupZone}-${dropoffZone}-${seats}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <FareCard
                  soloFarePaisa={quoteQuery.data.soloFarePaisa}
                  pooledFarePaisa={quoteQuery.data.pooledFarePaisa}
                  isFinal={false}
                  pooled={false}
                />
              </motion.div>
            )}

            {createRide.isError && (
              <ErrorBanner
                message={
                  createRide.error instanceof ApiError
                    ? messageForError(createRide.error.code, createRide.error.message)
                    : "Something went wrong."
                }
                onRetry={() => createRide.mutate()}
              />
            )}

            <Button
              type="submit"
              disabled={!quoteQuery.data || createRide.isPending}
              className="w-full"
            >
              {createRide.isPending ? "Requesting…" : "Request Tesla"}
            </Button>
          </form>
        </div>
      }
      map={
        <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
          <ZoneMap
            className="h-full w-full"
            showRoute={mapMarkers.length === 2}
            markers={mapMarkers}
          />
        </Suspense>
      }
    />
  );
}
