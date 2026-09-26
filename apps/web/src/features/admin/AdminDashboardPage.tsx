import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import type { Driver, Zone } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

// Replaces hand-editing db/seed/index.ts to add a driver (plan A3 reversal:
// registration still can't self-elevate to DRIVER, only an ADMIN can create
// one). Scope deliberately stays create + list — no edit/suspend yet.
export function AdminDashboardPage() {
  const queryClient = useQueryClient();

  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: ({ signal }) => api.get<Zone[]>("/zones", signal),
    staleTime: Infinity,
  });
  const driversQuery = useQuery({
    queryKey: ["admin", "drivers"],
    queryFn: ({ signal }) => api.get<Driver[]>("/admin/drivers", signal),
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [zone, setZone] = useState("");

  const createDriver = useMutation({
    mutationFn: () =>
      api.post<Driver>("/admin/drivers", {
        name,
        email,
        password,
        vehicleName,
        capacity,
        ...(zone ? { zone } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "drivers"] });
      setName("");
      setEmail("");
      setPassword("");
      setVehicleName("");
      setCapacity(4);
      setZone("");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createDriver.mutate();
  }

  const zones = zonesQuery.data ?? [];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-lg font-bold text-neutral-900">Create a driver</h1>
        <form className="mt-4 space-y-4 rounded-lg border border-neutral-200 bg-white p-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-neutral-700">
              Driver name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-neutral-700">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-neutral-700">
              Temporary password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-neutral-700">
              Vehicle name
              <input
                required
                value={vehicleName}
                onChange={(event) => setVehicleName(event.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-neutral-700">
              Seat capacity
              <input
                type="number"
                min={1}
                max={6}
                required
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value))}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-neutral-700">
              Starting zone (optional)
              <select
                value={zone}
                onChange={(event) => setZone(event.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                <option value="">Unset — driver picks on go-online</option>
                {zones.map((z) => (
                  <option key={z.code} value={z.code}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {createDriver.isError && (
            <ErrorBanner
              message={
                createDriver.error instanceof ApiError
                  ? messageForError(createDriver.error.code, createDriver.error.message)
                  : "Something went wrong."
              }
              onRetry={() => createDriver.mutate()}
            />
          )}
          {createDriver.isSuccess && <p className="text-sm text-green-700">Driver created.</p>}

          <button
            type="submit"
            disabled={createDriver.isPending}
            className="w-full rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
          >
            {createDriver.isPending ? "Creating…" : "Create driver"}
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-bold text-neutral-900">Drivers</h2>
        {driversQuery.isPending && <p className="mt-2 text-sm text-neutral-400">Loading…</p>}
        {driversQuery.isError && (
          <ErrorBanner message="We can't reach the server. Retry." onRetry={() => void driversQuery.refetch()} />
        )}
        {driversQuery.data && driversQuery.data.length === 0 && (
          <p className="mt-2 text-sm text-neutral-500">No drivers yet.</p>
        )}
        {driversQuery.data && driversQuery.data.length > 0 && (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {driversQuery.data.map((driver) => (
              <li key={driver.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="font-medium text-neutral-900">{driver.name}</p>
                  <p className="text-neutral-500">{driver.email}</p>
                </div>
                <div className="text-right text-neutral-500">
                  <p>
                    {driver.vehicle.name} · {driver.vehicle.capacity} seats
                  </p>
                  <p>{driver.vehicle.isOnline ? `Online · ${driver.vehicle.currentZone}` : "Offline"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
