import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Banknote, Minus, Plus, Wallet as WalletIcon } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import {
  ACTIVE_RIDE_STATUSES,
  type FareQuote,
  type RideRequest,
  type WalletSummary,
} from "../../lib/types.js";
import { ZonePicker } from "../../components/map/ZonePicker.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

const SEAT_MIN = 1;
const SEAT_MAX = 3;

function ActiveRideCard({ ride }: { ride: RideRequest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="max-w-md">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-text-faint">Active ride</p>
          <Badge tone="accent">{ride.status.replace("_", " ").toLowerCase()}</Badge>
        </div>
        <p className="mt-2 font-display text-lg font-semibold text-text">
          {ride.pickupZone} → {ride.dropoffZone}
        </p>
        <Link to={`/p/rides/${ride.id}`}>
          <Button className="mt-4 w-full">View ride</Button>
        </Link>
      </Card>
    </motion.div>
  );
}

function HomeSkeleton() {
  return (
    <div className="max-w-md space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
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

  const [pickupZone, setPickupZone] = useState("");
  const [dropoffZone, setDropoffZone] = useState("");
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TESLAPAY">("CASH");

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
      <ErrorBanner
        message="We can't reach the server. Retry."
        coldStart={isColdStart(recentRidesQuery as never) || isColdStart(zonesQuery as never)}
        onRetry={() => {
          void recentRidesQuery.refetch();
          void zonesQuery.refetch();
        }}
      />
    );
  }

  const activeRide = recentRidesQuery.data.data.find((ride) =>
    ACTIVE_RIDE_STATUSES.includes(ride.status),
  );
  if (activeRide) {
    return <ActiveRideCard ride={activeRide} />;
  }

  const zones = zonesQuery.data;
  const balance = walletQuery.data?.balancePaisa;

  return (
    <div className="max-w-md">
      <h1 className="font-display text-xl font-bold text-text">Request a ride</h1>
      <Card className="mt-4">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <ZonePicker
            id="pickup"
            label="Pickup"
            tone="pickup"
            value={pickupZone}
            onChange={setPickupZone}
            zones={zones}
          />
          <ZonePicker
            id="dropoff"
            label="Drop-off"
            tone="dropoff"
            value={dropoffZone}
            onChange={setDropoffZone}
            zones={zones}
            excludeZoneCode={pickupZone}
          />
          {pickupZone && dropoffZone && pickupZone === dropoffZone && (
            <p className="text-sm text-danger">Pickup and drop-off must be different.</p>
          )}

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
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("CASH")}
                className={
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors " +
                  (paymentMethod === "CASH"
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : "border-border-strong text-text-muted hover:text-text")
                }
              >
                <Banknote size={15} strokeWidth={2.25} />
                Cash
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("TESLAPAY")}
                className={
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors " +
                  (paymentMethod === "TESLAPAY"
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : "border-border-strong text-text-muted hover:text-text")
                }
              >
                <WalletIcon size={15} strokeWidth={2.25} />
                TeslaPay
                {typeof balance === "number" ? ` · ${formatPaisaAsTaka(paisa(balance))}` : ""}
              </button>
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
      </Card>
    </div>
  );
}
