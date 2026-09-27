import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "../../lib/api-client.js";
import { isColdStart } from "../../lib/polling.js";
import type { AdminRideDetail } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { StatusStepper } from "../../components/ui/StatusStepper.js";
import { FareCard } from "../../components/ui/FareCard.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Timeline } from "../../components/ui/Timeline.js";
import { terminalStatusTone } from "./adminDisplay.js";

export function AdminRideDetailPage() {
  const { id } = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: ["admin", "ride-requests", id],
    queryFn: ({ signal }) => api.get<AdminRideDetail>(`/admin/ride-requests/${id}`, signal),
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

  const ride = query.data;

  return (
    <PageContainer>
      <Link
        to="/a/rides"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft size={15} strokeWidth={2.25} />
        Back
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text">
            {ride.pickupZone} → {ride.dropoffZone}
          </h1>
          <p className="text-sm text-text-muted">
            <Link
              to={`/a/users/${ride.passengerId}`}
              className="font-medium text-accent-strong hover:underline"
            >
              {ride.passengerName}
            </Link>{" "}
            · {ride.passengerEmail} · {ride.seats} seat{ride.seats > 1 ? "s" : ""}
          </p>
        </div>
        <Badge tone={terminalStatusTone(ride.status)}>
          {ride.status.replace("_", " ").toLowerCase()}
        </Badge>
      </div>

      <div className="mt-6">
        <StatusStepper status={ride.status} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-4">
          <FareCard
            soloFarePaisa={ride.soloFarePaisa}
            pooledFarePaisa={ride.pooledFarePaisa}
            isFinal={ride.status === "STARTED" || ride.status === "COMPLETED"}
            pooled={(ride.pool?.sharedWithCount ?? 0) > 0}
          />

          {ride.cancelReason && (
            <Card>
              <h2 className="text-sm font-semibold text-text">Cancellation reason</h2>
              <p className="mt-1 text-sm text-text-muted">{ride.cancelReason}</p>
            </Card>
          )}

          {ride.pool ? (
            <Card>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-text">
                  {ride.pool.vehicleName} · {ride.pool.driverFirstName}
                </p>
                <Badge tone={terminalStatusTone(ride.pool.status)}>
                  {ride.pool.status.replace("_", " ").toLowerCase()}
                </Badge>
              </div>
              <div className="mt-2">
                <SeatMeter
                  capacity={ride.pool.capacitySnapshot}
                  reserved={ride.pool.seatsReserved}
                />
              </div>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-faint">
                Passengers
              </h3>
              <ul className="mt-2 divide-y divide-border">
                {ride.pool.members.map((member) => (
                  <li
                    key={member.membershipId}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-text">
                      {member.passengerName} → {member.dropoffZone}
                    </span>
                    <Badge
                      tone={
                        member.droppedOffAt ? "success" : member.releasedAt ? "neutral" : "accent"
                      }
                    >
                      {member.droppedOffAt ? "dropped off" : member.releasedAt ? "left" : "aboard"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-text-muted">Never matched with a pool.</p>
            </Card>
          )}
        </div>

        <Card>
          <h2 className="text-sm font-semibold text-text">Timeline</h2>
          <div className="mt-3">
            <Timeline entries={ride.history} />
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
