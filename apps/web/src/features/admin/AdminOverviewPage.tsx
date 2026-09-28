import { useQuery } from "@tanstack/react-query";
import { Car, CheckCircle2, Clock, MapPin, Users, XCircle } from "lucide-react";
import { api } from "../../lib/api-client.js";
import { createRefetchInterval, isColdStart, POLL_BASE_MS } from "../../lib/polling.js";
import type { AdminStats } from "../../lib/types.js";
import { PageContainer } from "../../components/layout/PageContainer.js";
import { Card } from "../../components/ui/Card.js";
import { Skeleton } from "../../components/ui/Skeleton.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

const TILES = [
  { key: "totalRides", label: "Total rides", Icon: Car },
  { key: "activeRides", label: "Active now", Icon: Clock },
  { key: "completedRides", label: "Completed", Icon: CheckCircle2 },
  { key: "cancelledRides", label: "Cancelled", Icon: XCircle },
  { key: "onlineDrivers", label: "Online drivers", Icon: Users },
  { key: "activePools", label: "Active pools", Icon: MapPin },
] as const;

export function AdminOverviewPage() {
  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: ({ signal }) => api.get<AdminStats>("/admin/stats", signal),
    refetchInterval: createRefetchInterval<AdminStats>({
      baseMs: POLL_BASE_MS.adminOverview,
      isTerminal: () => false,
    }),
  });

  if (statsQuery.isPending) {
    return (
      <PageContainer>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {TILES.map((tile) => (
            <Skeleton key={tile.key} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </PageContainer>
    );
  }

  if (statsQuery.isError) {
    return (
      <PageContainer className="flex flex-1 items-center">
        <ErrorBanner
          message="We can't reach the server. Retry."
          coldStart={isColdStart(statsQuery as never)}
          onRetry={() => void statsQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const { totals, byZone } = statsQuery.data;

  return (
    <PageContainer>
      <h1 className="font-display text-2xl font-bold text-text">Overview</h1>
      <p className="mt-1 text-sm text-text-muted">
        What actually exists right now — zone-level, the same precision the rest of the app uses.
        Updates automatically.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map(({ key, label, Icon }) => (
          <Card key={key}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
              <Icon size={16} strokeWidth={2.25} />
            </span>
            <p className="tabular mt-3 font-display text-2xl font-bold text-text">{totals[key]}</p>
            <p className="text-xs text-text-muted">{label}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-medium uppercase tracking-wide text-text-faint">
                <th className="px-4 py-2.5">Zone</th>
                <th className="px-4 py-2.5">Online drivers</th>
                <th className="px-4 py-2.5">Open requests</th>
                <th className="px-4 py-2.5">Active pools</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {byZone.map((zone) => (
                <tr key={zone.zoneCode}>
                  <td className="px-4 py-2.5 font-medium text-text">{zone.zoneName}</td>
                  <td className="tabular px-4 py-2.5 text-text-muted">{zone.onlineDrivers}</td>
                  <td className="tabular px-4 py-2.5 text-text-muted">{zone.openRequests}</td>
                  <td className="tabular px-4 py-2.5 text-text-muted">{zone.activePools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageContainer>
  );
}
