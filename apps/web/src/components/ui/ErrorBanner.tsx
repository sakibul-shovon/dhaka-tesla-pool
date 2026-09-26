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
      className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <span>{coldStart ? "Waking up the server — this can take about a minute on the free plan." : message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex-none rounded border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}
