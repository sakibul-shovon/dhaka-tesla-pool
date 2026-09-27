import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import type { Driver, Zone } from "../../lib/types.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { useToast } from "../../components/ui/Toast.js";

// Replaces hand-editing db/seed/index.ts to add a driver (plan A3 reversal:
// registration still can't self-elevate to DRIVER, only an ADMIN can create
// one). Scope deliberately stays create + list — no edit/suspend yet.
export function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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
    onSuccess: (driver) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "drivers"] });
      setName("");
      setEmail("");
      setPassword("");
      setVehicleName("");
      setCapacity(4);
      setZone("");
      showToast({ message: `${driver.name} added as a driver.`, tone: "success" });
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
        <h1 className="font-display text-xl font-bold text-text">Create a driver</h1>
        <Card className="mt-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="driver-name" className="block text-sm font-medium text-text">
                  Driver name
                </label>
                <Input
                  id="driver-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="driver-email" className="block text-sm font-medium text-text">
                  Email
                </label>
                <Input
                  id="driver-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="driver-password" className="block text-sm font-medium text-text">
                  Temporary password
                </label>
                <Input
                  id="driver-password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="vehicle-name" className="block text-sm font-medium text-text">
                  Vehicle name
                </label>
                <Input
                  id="vehicle-name"
                  required
                  value={vehicleName}
                  onChange={(event) => setVehicleName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="capacity" className="block text-sm font-medium text-text">
                  Seat capacity
                </label>
                <Input
                  id="capacity"
                  type="number"
                  min={1}
                  max={6}
                  required
                  value={capacity}
                  onChange={(event) => setCapacity(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="starting-zone" className="block text-sm font-medium text-text">
                  Starting zone (optional)
                </label>
                <Select
                  id="starting-zone"
                  value={zone}
                  onChange={(event) => setZone(event.target.value)}
                >
                  <option value="">Unset — driver picks on go-online</option>
                  {zones.map((z) => (
                    <option key={z.code} value={z.code}>
                      {z.name}
                    </option>
                  ))}
                </Select>
              </div>
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

            <Button type="submit" disabled={createDriver.isPending} className="w-full sm:w-auto">
              {createDriver.isPending ? "Creating…" : "Create driver"}
            </Button>
          </form>
        </Card>
      </div>

      <div>
        <h2 className="font-display text-xl font-bold text-text">Drivers</h2>
        {driversQuery.isPending && <Skeleton className="mt-3 h-32 rounded-2xl" />}
        {driversQuery.isError && (
          <ErrorBanner
            message="We can't reach the server. Retry."
            onRetry={() => void driversQuery.refetch()}
          />
        )}
        {driversQuery.data && driversQuery.data.length === 0 && (
          <div className="mt-3">
            <EmptyState
              icon={Users}
              title="No drivers yet"
              description="Create one above to get started."
            />
          </div>
        )}
        {driversQuery.data && driversQuery.data.length > 0 && (
          <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
            {driversQuery.data.map((driver) => (
              <div key={driver.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="font-medium text-text">{driver.name}</p>
                  <p className="text-text-muted">{driver.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-text-muted">
                    {driver.vehicle.name} · {driver.vehicle.capacity} seats
                  </p>
                  <Badge tone={driver.vehicle.isOnline ? "success" : "neutral"}>
                    {driver.vehicle.isOnline ? `Online · ${driver.vehicle.currentZone}` : "Offline"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
