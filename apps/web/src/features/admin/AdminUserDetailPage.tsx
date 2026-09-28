import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2 } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { api, ApiError } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { AccountDetail, AccountSummary } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { Modal } from "../../components/ui/Modal.js";
import { accountStatusTone, roleTone, terminalStatusTone } from "./adminDisplay.js";

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["admin", "users", id],
    queryFn: ({ signal }) => api.get<AccountDetail>(`/admin/users/${id}`, signal),
  });

  function closeModal() {
    setConfirmOpen(null);
    setReason("");
  }

  const mutation = useMutation({
    // The API returns the base account shape here (no statusHistory/
    // passenger/driver) -- AccountDetail is only what GET returns. Merging
    // into the existing cached detail (not replacing it) keeps those fields
    // intact until the invalidate below refetches the real thing; replacing
    // wholesale crashed the page the first time this was actually clicked
    // (account.statusHistory.length on a now-undefined field).
    mutationFn: (command: "suspend" | "reactivate") =>
      api.post<AccountSummary>(
        `/admin/users/${id}/${command}`,
        reason.trim() ? { reason: reason.trim() } : {},
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<AccountDetail>(["admin", "users", id], (prev) =>
        prev ? { ...prev, ...updated } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
      closeModal();
    },
  });

  if (query.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 rounded-2xl" />
      </PageContainer>
    );
  }

  if (query.isError) {
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(query as never)}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  const account = query.data;

  return (
    <PageContainer>
      <Link
        to="/a/users"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft size={15} strokeWidth={2.25} />
        Back
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">{account.name}</h1>
          <p className="text-sm text-text-muted">{account.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={roleTone(account.role)}>{account.role.toLowerCase()}</Badge>
          <Badge tone={accountStatusTone(account.status)}>{account.status.toLowerCase()}</Badge>
          {account.role !== "ADMIN" &&
            (account.status === "ACTIVE" ? (
              <Button
                variant="danger"
                onClick={() => setConfirmOpen("suspend")}
                icon={<Ban size={15} strokeWidth={2.25} />}
              >
                Suspend
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirmOpen("reactivate")}
                icon={<CheckCircle2 size={15} strokeWidth={2.25} />}
              >
                Reactivate
              </Button>
            ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-4">
          {account.passenger && (
            <Card>
              <h2 className="text-sm font-semibold text-text">TeslaPay</h2>
              <p className="tabular mt-1 font-display text-2xl font-bold text-text">
                {formatPaisaAsTaka(paisa(account.passenger.wallet.balancePaisa))}
              </p>
              <h2 className="mt-5 text-sm font-semibold text-text">Recent rides</h2>
              {account.passenger.recentRides.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">No rides yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {account.passenger.recentRides.map((ride) => (
                    <li key={ride.id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="text-text">
                        {ride.pickupZone} → {ride.dropoffZone}
                      </span>
                      <Badge tone={terminalStatusTone(ride.status)}>
                        {ride.status.replace("_", " ").toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {account.driver && (
            <Card>
              <h2 className="text-sm font-semibold text-text">Vehicle</h2>
              {account.driver.vehicle ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-text">
                    {account.driver.vehicle.name} · {account.driver.vehicle.capacity} seats
                  </span>
                  <Badge tone={account.driver.vehicle.isOnline ? "success" : "neutral"}>
                    {account.driver.vehicle.isOnline
                      ? `Online · ${account.driver.vehicle.currentZone}`
                      : "Offline"}
                  </Badge>
                </div>
              ) : (
                <p className="mt-2 text-sm text-text-muted">No vehicle registered.</p>
              )}
              <h2 className="mt-5 text-sm font-semibold text-text">Recent pools</h2>
              {account.driver.recentPools.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">No pools yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {account.driver.recentPools.map((pool) => (
                    <li key={pool.id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="text-text">Pickup: {pool.pickupZone}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-text-muted">
                          {formatPaisaAsTaka(paisa(pool.earningsPaisa))}
                        </span>
                        <Badge tone={terminalStatusTone(pool.status)}>
                          {pool.status.replace("_", " ").toLowerCase()}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {!account.passenger && !account.driver && (
            <Card>
              <p className="text-sm text-text-muted">
                Admin accounts have no ride or driver activity to show.
              </p>
            </Card>
          )}
        </div>

        <Card>
          <h2 className="text-sm font-semibold text-text">Account history</h2>
          <div className="mt-3">
            {account.statusHistory.length === 0 ? (
              <p className="text-sm text-text-muted">No status changes yet.</p>
            ) : (
              <Timeline entries={account.statusHistory} />
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={confirmOpen !== null}
        onClose={closeModal}
        title={confirmOpen === "suspend" ? "Suspend this account?" : "Reactivate this account?"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              variant={confirmOpen === "suspend" ? "danger" : "primary"}
              onClick={() => confirmOpen && mutation.mutate(confirmOpen)}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Working…"
                : confirmOpen === "suspend"
                  ? "Suspend"
                  : "Reactivate"}
            </Button>
          </>
        }
      >
        <p>
          {confirmOpen === "suspend"
            ? "They'll be signed out everywhere immediately and won't be able to sign back in until reactivated."
            : "They'll be able to sign in again."}
        </p>
        <div className="mt-3 space-y-1.5">
          <label htmlFor="admin-reason" className="block text-sm font-medium text-text">
            Reason (optional)
          </label>
          <Input
            id="admin-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {mutation.isError && (
          // The server's own message here is already written for exactly
          // this admin action (e.g. "this passenger has a ride in
          // progress...") — the shared messageForError catalog is tuned for
          // a passenger's own screens and would show the wrong wording for
          // a code like ACTIVE_RIDE_EXISTS in this context.
          <p className="mt-2 text-sm text-danger">
            {mutation.error instanceof ApiError ? mutation.error.message : "Something went wrong."}
          </p>
        )}
      </Modal>
    </PageContainer>
  );
}
