import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";

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
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {isFinal ? "Fare" : "Estimated fare"}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        {pooled && (
          <span className="text-lg text-neutral-400 line-through">{formatPaisaAsTaka(paisa(soloFarePaisa))}</span>
        )}
        <span className="text-3xl font-bold text-neutral-900">
          {formatPaisaAsTaka(paisa(pooled ? pooledFarePaisa : soloFarePaisa))}
        </span>
      </div>
      {pooled && <p className="mt-1 text-sm text-neutral-500">Shared with another passenger</p>}
      {!pooled && !isFinal && <p className="mt-1 text-sm text-neutral-500">Drops if someone shares your Tesla</p>}
    </div>
  );
}
