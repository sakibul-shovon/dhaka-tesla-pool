import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import { TERMINAL_POOL_STATUSES, type Pool, type PoolDetail, type PoolMember, type PoolStatusHistoryEntry } from "../../lib/types.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

function memberState(member: PoolMember): string {
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
    mutationFn: () => api.post<Pool>(`/driver/pools/${poolId}/memberships/${member.membershipId}/drop-off`),
    onSuccess: invalidate,
  });
  const noShow = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${poolId}/memberships/${member.membershipId}/no-show`),
    onSuccess: invalidate,
  });

  const active = !member.releasedAt && !member.droppedOffAt;
  const canDropOff = active && poolStatus === "STARTED";
  const canNoShow = active && poolStatus === "DRIVER_ARRIVED";

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">{member.passengerName}</p>
          <p className="text-xs text-neutral-500">
            → {member.dropoffZone} · {member.seats} seat{member.seats > 1 ? "s" : ""} · {memberState(member)}
          </p>
        </div>
        <div className="flex flex-none gap-2">
          {canDropOff && (
            <button
              type="button"
              onClick={() => dropOff.mutate()}
              disabled={dropOff.isPending}
              className="rounded bg-[--color-accent] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Drop off
            </button>
          )}
          {canNoShow && (
            <button
              type="button"
              onClick={() => noShow.mutate()}
              disabled={noShow.isPending}
              className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 disabled:opacity-50"
            >
              No-show
            </button>
          )}
        </div>
      </div>
      {(dropOff.isError || noShow.isError) && (
        <p className="mt-1 text-xs text-red-600">
          {(() => {
            const error = dropOff.error ?? noShow.error;
            return error instanceof ApiError ? messageForError(error.code, error.message) : "Something went wrong.";
          })()}
        </p>
      )}
    </li>
  );
}

export function DriverPoolPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");

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
    queryFn: ({ signal }) => api.get<PoolStatusHistoryEntry[]>(`/driver/pools/${id}/history`, signal),
  });

  const poolStatus = poolQuery.data?.pool.status;
  useEffect(() => {
    if (poolStatus) {
      void queryClient.invalidateQueries({ queryKey: ["driver", "pools", id, "history"] });
    }
    // Only re-run on an actual status transition, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolStatus]);

  const invalidatePool = () => void queryClient.invalidateQueries({ queryKey: ["driver", "pools", id] });

  const arrive = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${id}/arrive`),
    onSuccess: invalidatePool,
  });
  const start = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${id}/start`),
    onSuccess: invalidatePool,
  });
  const cancelPool = useMutation({
    mutationFn: () => api.post<Pool>(`/driver/pools/${id}/cancel`, cancelReason ? { reason: cancelReason } : {}),
    onSuccess: invalidatePool,
  });

  if (poolQuery.isPending) {
    return <div className="h-40 max-w-md animate-pulse rounded-lg bg-neutral-100" />;
  }

  if (poolQuery.isError) {
    return (
      <ErrorBanner
        message="We can't reach the server. Retry."
        coldStart={isColdStart(poolQuery as never)}
        onRetry={() => void poolQuery.refetch()}
      />
    );
  }

  const { pool, members } = poolQuery.data;
  const actionError = arrive.error ?? start.error ?? cancelPool.error;

  return (
    <div className="max-w-md space-y-4">
      <Link to="/d" className="text-sm text-neutral-500 hover:text-neutral-700">
        ← Back
      </Link>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <p className="text-lg font-semibold text-neutral-900">Pickup: {pool.pickupZone}</p>
        <p className="text-sm text-neutral-500">Status: {pool.status.replace("_", " ").toLowerCase()}</p>
        <div className="mt-3">
          <SeatMeter capacity={pool.capacitySnapshot} reserved={pool.seatsReserved} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pool.status === "OPEN" && (
            <button
              type="button"
              onClick={() => arrive.mutate()}
              disabled={arrive.isPending}
              className="rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {arrive.isPending ? "Marking arrived…" : "I've arrived"}
            </button>
          )}
          {pool.status === "DRIVER_ARRIVED" && (
            <button
              type="button"
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className="rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {start.isPending ? "Starting…" : "Start trip"}
            </button>
          )}
          {(pool.status === "OPEN" || pool.status === "DRIVER_ARRIVED") && (
            <button
              type="button"
              onClick={() => cancelPool.mutate()}
              disabled={cancelPool.isPending}
              className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {cancelPool.isPending ? "Cancelling…" : "Cancel pool"}
            </button>
          )}
        </div>
        {(pool.status === "OPEN" || pool.status === "DRIVER_ARRIVED") && (
          <input
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Cancellation reason (optional)"
            className="mt-2 w-full rounded border border-neutral-200 px-2 py-1 text-xs"
          />
        )}
        {actionError && (
          <p className="mt-2 text-sm text-red-600">
            {actionError instanceof ApiError ? messageForError(actionError.code, actionError.message) : "Something went wrong."}
          </p>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Passengers</h2>
        <ul className="mt-2 space-y-2">
          {members.map((member) => (
            <MemberRow key={member.membershipId} poolId={pool.id} poolStatus={pool.status} member={member} />
          ))}
        </ul>
      </div>

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
