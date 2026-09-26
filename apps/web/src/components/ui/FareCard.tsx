import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { Zap } from "lucide-react";

export function FareCard({
  soloFarePaisa,
  pooledFarePaisa,
  isFinal,
  pooled,
}: {
  soloFarePaisa: number;
  pooledFarePaisa: number;
  isFinal: boolean;
  /** Whether pooling actually applies (an active pool-mate before start, the frozen outcome after) — not just "would this trip discount if pooled". */
  pooled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-text-faint">
          {isFinal ? "Fare" : "Estimated fare"}
        </p>
        {pooled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-electric-soft px-2.5 py-1 text-xs font-medium text-electric">
            <Zap size={12} strokeWidth={2.5} />
            Pooled
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2.5">
        {pooled && (
          <span className="tabular text-lg text-text-faint line-through">
            {formatPaisaAsTaka(paisa(soloFarePaisa))}
          </span>
        )}
        <span className="font-display tabular text-4xl font-bold text-text">
          {formatPaisaAsTaka(paisa(pooled ? pooledFarePaisa : soloFarePaisa))}
        </span>
      </div>
      {pooled && <p className="mt-1.5 text-sm text-text-muted">Shared with another passenger</p>}
      {!pooled && !isFinal && <p className="mt-1.5 text-sm text-text-muted">Drops if someone shares your Tesla</p>}
    </div>
  );
}
