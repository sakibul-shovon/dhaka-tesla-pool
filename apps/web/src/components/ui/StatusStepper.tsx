import type { RideStatus } from "../../lib/types.js";

const STEPS: { status: RideStatus; label: string }[] = [
  { status: "REQUESTED", label: "Waiting" },
  { status: "MATCHED", label: "Matched" },
  { status: "DRIVER_ARRIVED", label: "Driver arrived" },
  { status: "STARTED", label: "On the way" },
  { status: "COMPLETED", label: "Completed" },
];

export function StatusStepper({ status }: { status: RideStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-600">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-400" aria-hidden />
        Cancelled
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((step) => step.status === status);

  return (
    <ol className="flex w-full items-center" aria-label="Ride status">
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold " +
                  (isDone
                    ? "border-[--color-accent] bg-[--color-accent] text-white"
                    : isCurrent
                      ? "border-[--color-accent] bg-white text-[--color-accent]"
                      : "border-neutral-300 bg-white text-neutral-400")
                }
                aria-current={isCurrent ? "step" : undefined}
              >
                {isDone ? "✓" : index + 1}
              </span>
              <span
                className={"whitespace-nowrap text-[11px] " + (isCurrent ? "font-semibold text-neutral-900" : "text-neutral-500")}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div className={"mx-1 h-0.5 flex-1 " + (isDone ? "bg-[--color-accent]" : "bg-neutral-200")} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
