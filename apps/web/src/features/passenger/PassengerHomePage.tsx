import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { ACTIVE_RIDE_STATUSES, type FareQuote, type RideRequest, type Zone } from "../../lib/types.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

function ActiveRideCard({ ride }: { ride: RideRequest }) {
  return (
    <div className="max-w-md rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Active ride</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">
        {ride.pickupZone} → {ride.dropoffZone}
      </p>
      <p className="mt-1 text-sm text-neutral-500">Status: {ride.status.replace("_", " ").toLowerCase()}</p>
      <Link
        to={`/p/rides/${ride.id}`}
        className="mt-4 inline-block rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white"
      >
        View ride
      </Link>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="max-w-md animate-pulse space-y-3">
      <div className="h-5 w-40 rounded bg-neutral-200" />
      <div className="h-40 rounded-lg bg-neutral-100" />
    </div>
  );
}

export function PassengerHomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: ({ signal }) => api.get<Zone[]>("/zones", signal),
    staleTime: Infinity,
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
  // The deps intentionally drive regeneration without being read in the body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intentKey = useMemo(() => crypto.randomUUID(), [pickupZone, dropoffZone, seats]);

  const createRide = useMutation({
    mutationFn: () =>
      api.post<RideRequest>("/ride-requests", { pickupZone, dropoffZone, seats, paymentMethod: "CASH" }, intentKey),
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
        onRetry={() => {
          void recentRidesQuery.refetch();
          void zonesQuery.refetch();
        }}
      />
    );
  }

  const activeRide = recentRidesQuery.data.data.find((ride) => ACTIVE_RIDE_STATUSES.includes(ride.status));
  if (activeRide) {
    return <ActiveRideCard ride={activeRide} />;
  }

  const zones = zonesQuery.data;

  return (
    <div className="max-w-md">
      <h1 className="text-lg font-bold text-neutral-900">Request a ride</h1>
      <form className="mt-4 space-y-4 rounded-lg border border-neutral-200 bg-white p-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-neutral-700">
          Pickup
          <select
            required
            value={pickupZone}
            onChange={(event) => setPickupZone(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.code} value={zone.code}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-neutral-700">
          Drop-off
          <select
            required
            value={dropoffZone}
            onChange={(event) => setDropoffZone(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.code} value={zone.code}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        {pickupZone && dropoffZone && pickupZone === dropoffZone && (
          <p className="text-sm text-red-600">Pickup and drop-off must be different.</p>
        )}
        <label className="block text-sm text-neutral-700">
          Seats
          <input
            type="number"
            min={1}
            max={6}
            required
            value={seats}
            onChange={(event) => setSeats(Number(event.target.value))}
            className="mt-1 w-24 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <p className="text-sm text-neutral-500">Payment: Cash</p>

        {quoteEnabled && quoteQuery.isPending && <p className="text-sm text-neutral-400">Getting a quote…</p>}
        {quoteEnabled && quoteQuery.isError && <p className="text-sm text-red-600">Couldn't get a quote — try again.</p>}
        {quoteQuery.data && (
          <FareCard
            soloFarePaisa={quoteQuery.data.soloFarePaisa}
            pooledFarePaisa={quoteQuery.data.pooledFarePaisa}
            isFinal={false}
          />
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

        <button
          type="submit"
          disabled={!quoteQuery.data || createRide.isPending}
          className="w-full rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createRide.isPending ? "Requesting…" : "Request Tesla"}
        </button>
      </form>
    </div>
  );
}
