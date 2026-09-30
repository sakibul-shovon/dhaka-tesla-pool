import { AlertTriangle } from "lucide-react";

// Covers the async-state matrix's server-down / waking-up / plain-error
// rows (plan §15.3) with one component instead of ad-hoc JSX per screen.
export function ErrorBanner({
  message,
  coldStart,
  onRetry,
}: {
  message: string;
  coldStart?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-sm text-warning"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} strokeWidth={2.25} className="flex-none" />
        {coldStart ? "Waking up the server — this can take about a minute on the free plan." : message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex-none rounded-lg border border-warning/40 px-2.5 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning-soft"
        >
          Retry
        </button>
      )}
    </div>
  );
}
