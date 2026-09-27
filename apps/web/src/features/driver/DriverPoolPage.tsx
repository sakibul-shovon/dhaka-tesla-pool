import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { useZones } from "../../lib/zones.js";
import {
  TERMINAL_POOL_STATUSES,
  type Pool,
  type PoolDetail,
  type PoolMember,
  type PoolStatusHistoryEntry,
} from "../../lib/types.js";
import { Workspace } from "../../components/layout/Workspace.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { Input } from "../../components/ui/Input.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { Modal } from "../../components/ui/Modal.js";

const ZoneMap = lazy(() =>
  import("../../components/map/ZoneMap.js").then((module) => ({ default: module.ZoneMap })),
);

function memberState(member: PoolMember): "left" | "dropped off" | "aboard" {
  if (member.releasedAt) return "left";
  if (member.droppedOffAt) return "dropped off";
  return "aboard";
}

function MemberRow({
  poolId,
  poolStatus,
  member,
}: {
  poolId: string;
  poolStatus: Pool["status"];
  member: PoolMember;
}) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["driver", "pools", poolId] });
  };

  const dropOff = useMutation({
    mutationFn: () =>
      api.post<Pool>(`/driver/pools/${poolId}/memberships/${member.membershipId}/drop-off`),
    onSuccess: invalidate,
  });
  const noShow = useMutation({
    mutationFn: () =>
      api.post<Pool>(`/driver/pools/${poolId}/memberships/${member.membershipId}/no-show`),
    onSuccess: invalidate,
  });

  const active = !member.releasedAt && !member.droppedOffAt;
  const canDropOff = active && poolStatus === "STARTED";
  const canNoShow = active && poolStatus === "DRIVER_ARRIVED";
  const state = memberState(member);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text">{member.passengerName}</p>
          <p className="text-xs text-text-muted">
            → {member.dropoffZone} · {member.seats} seat{member.seats > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge
            tone={state === "dropped off" ? "success" : state === "left" ? "neutral" : "accent"}
          >
            {state}
          </Badge>
          {canDropOff && (
            <Button
              onClick={() => dropOff.mutate()}
              disabled={dropOff.isPending}
              className="px-2.5 py-1.5 text-xs"
            >
              Drop off
            </Button>
          )}
          {canNoShow && (
            <Button
              variant="secondary"
              onClick={() => noShow.mutate()}
              disabled={noShow.isPending}
              className="px-2.5 py-1.5 text-xs"
            >
              No-show
            </Button>
          )}
        </div>
      </div>
      {(dropOff.isError || noShow.isError) && (
        <p className="mt-2 text-xs text-danger">
          {(() => {
            const error = dropOff.error ?? noShow.error;
            return error instanceof ApiError
              ? messageForError(error.code, error.message)
              : "Something went wrong.";
          })()}
        </p>
      )}
    </Card>
  );
}

function PoolSkeleton() {
  return (
    <Workspace
      panel={
        <div className="space-y-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      }
      map={<Skeleton className="h-full w-full rounded-none" />}
    />
  );
}

export function DriverPoolPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const zonesQuery = useZones();

  const poolQuery = useQuery({
    queryKey: ["driver", "pools", id],
    queryFn: ({ signal }) => api.get<PoolDetail>(`/driver/pools/${id}`, signal),
    refetchInterval: createRefetchInterval<PoolDetail>({
      baseMs: POLL_BASE_MS.driverPoll,
      isTerminal: (data) => TERMINAL_POOL_STATUSES.includes(data.pool.status),
    }),
  });

  const historyQuery = useQuery({
    queryKey: ["driver", "pools", id, "history"],
    queryFn: ({ signal }) =>
      api.get<PoolStatusHistoryEntry[]>(`/driver/pools/${id}/history`, signal),
  });

  const poolStatus = poolQuery.data?.pool.status;
  useEffect(() => {
    if (poolStatus) {
      void queryClient.invalidateQueries({ queryKey: ["driver", "pools", id, "history"] });
    }
    // Only re-run on an actual status transition, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolStatus]);

  const invalidatePool = () =>
    void queryClient.invalidateQueries({ queryKey: ["driver", "pools", id] });

  const arrive = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${id}/arrive`),
    onSuccess: invalidatePool,
  });
  const start = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${id}/start`),
    onSuccess: invalidatePool,
  });
  const cancelPool = useMutation({
    mutationFn: () =>
      api.post<Pool>(`/driver/pools/${id}/cancel`, cancelReason ? { reason: cancelReason } : {}),
    onSuccess: () => {
      invalidatePool();
      setConfirmCancelOpen(false);
    },
  });

  if (poolQuery.isPending) {
    return <PoolSkeleton />;
  }

  if (poolQuery.isError) {
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(poolQuery as never)}
          onRetry={() => void poolQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const { pool, members } = poolQuery.data;
  const actionError = arrive.error ?? start.error;
  const zones = zonesQuery.data ?? [];
  const zoneName = (code: string) => zones.find((zone) => zone.code === code)?.name ?? code;
  const canCancel = pool.status === "OPEN" || pool.status === "DRIVER_ARRIVED";
  const activeDropoffs = [
    ...new Set(members.filter((member) => !member.releasedAt).map((member) => member.dropoffZone)),
  ];

  return (
    <>
      <Workspace
        panel={
          <div className="flex h-full flex-col">
            <Link
              to="/d"
              className="inline-flex w-fit items-center gap-1 text-sm text-text-muted hover:text-text"
            >
              <ArrowLeft size={15} strokeWidth={2.25} />
              Back
            </Link>

            <div className="mt-3 flex items-center justify-between">
              <h1 className="font-display text-2xl font-bold text-text">
                Pickup: {zoneName(pool.pickupZone)}
              </h1>
              <Badge tone="accent">{pool.status.replace("_", " ").toLowerCase()}</Badge>
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-surface-raised p-4">
              <SeatMeter capacity={pool.capacitySnapshot} reserved={pool.seatsReserved} size="lg" />
            </div>

            {actionError && (
              <p className="mt-3 text-sm text-danger">
                {actionError instanceof ApiError
                  ? messageForError(actionError.code, actionError.message)
                  : "Something went wrong."}
              </p>
            )}

            <div className="mt-5 flex-1 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-text">Passengers</h2>
                <ul className="mt-2 space-y-2">
                  {members.map((member) => (
                    <li key={member.membershipId}>
                      <MemberRow poolId={pool.id} poolStatus={pool.status} member={member} />
                    </li>
                  ))}
                </ul>
              </div>

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

            {/* One prominent next action, pinned to the bottom of the panel
                (plan round 3 §3: "Arrive → Start → Drop-offs") — drop-offs
                themselves happen per passenger above once the trip starts,
                so there's nothing pool-level left to press at that point. */}
            <div className="sticky bottom-0 -mx-4 mt-5 space-y-2 border-t border-border bg-bg px-4 pt-3 pb-1 sm:-mx-6 sm:px-6">
              {pool.status === "OPEN" && (
                <Button
                  onClick={() => arrive.mutate()}
                  disabled={arrive.isPending}
                  className="w-full"
                >
                  {arrive.isPending ? "Marking arrived…" : "I've arrived"}
                </Button>
              )}
              {pool.status === "DRIVER_ARRIVED" && (
                <Button
                  onClick={() => start.mutate()}
                  disabled={start.isPending}
                  className="w-full"
                >
                  {start.isPending ? "Starting…" : "Start trip"}
                </Button>
              )}
              {pool.status === "STARTED" && (
                <p className="py-2 text-center text-sm text-text-muted">
                  Drop each passenger off above as you complete their trip.
                </p>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  className="w-full py-1.5 text-center text-sm font-medium text-danger hover:underline"
                >
                  Cancel pool
                </button>
              )}
            </div>
          </div>
        }
        map={
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <ZoneMap
              className="h-full w-full"
              interactive={false}
              markers={[
                { zoneCode: pool.pickupZone, label: zoneName(pool.pickupZone), tone: "driver" },
                ...activeDropoffs.map((code) => ({
                  zoneCode: code,
                  label: zoneName(code),
                  tone: "dropoff" as const,
                })),
              ]}
            />
          </Suspense>
        }
      />

      <Modal
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Cancel this pool?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => cancelPool.mutate()}
              disabled={cancelPool.isPending}
            >
              {cancelPool.isPending ? "Cancelling…" : "Cancel pool"}
            </Button>
          </>
        }
      >
        <p>
          Every passenger currently aboard will be cancelled and will need to re-request. This can't
          be undone.
        </p>
        <div className="mt-3 space-y-1.5">
          <label htmlFor="cancel-reason" className="block text-sm font-medium text-text">
            Reason (optional)
          </label>
          <Input
            id="cancel-reason"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </div>
        {cancelPool.isError && (
          <p className="mt-2 text-sm text-danger">
            {cancelPool.error instanceof ApiError
              ? messageForError(cancelPool.error.code, cancelPool.error.message)
              : "Something went wrong."}
          </p>
        )}
      </Modal>
    </>
  );
}
