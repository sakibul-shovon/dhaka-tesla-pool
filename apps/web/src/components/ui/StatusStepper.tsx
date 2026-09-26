import type { ComponentType } from "react";
import { CheckCircle2, Clock, Flag, MapPin, Car } from "lucide-react";
import type { RideStatus } from "../../lib/types.js";

const STEPS: { status: RideStatus; label: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { status: "REQUESTED", label: "Waiting", Icon: Clock },
  { status: "MATCHED", label: "Matched", Icon: MapPin },
  { status: "DRIVER_ARRIVED", label: "Arrived", Icon: Flag },
  { status: "STARTED", label: "On the way", Icon: Car },
  { status: "COMPLETED", label: "Completed", Icon: CheckCircle2 },
];

export function StatusStepper({ status }: { status: RideStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-raised px-3 py-2.5 text-sm font-medium text-text-muted">
        <span className="h-2.5 w-2.5 rounded-full bg-text-faint" aria-hidden />
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
        const Icon = step.Icon;
        return (
          <li key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors " +
                  (isDone
                    ? "border-accent bg-accent text-bg"
                    : isCurrent
                      ? "animate-pulse-glow border-accent bg-accent-soft text-accent"
                      : "border-border-strong bg-surface-raised text-text-faint")
                }
                aria-current={isCurrent ? "step" : undefined}
              >
                <Icon size={15} strokeWidth={2.25} />
              </span>
              <span
                className={
                  "whitespace-nowrap text-[11px] " + (isCurrent ? "font-semibold text-text" : "text-text-faint")
                }
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={"mx-1 h-0.5 flex-1 rounded-full transition-colors " + (isDone ? "bg-accent" : "bg-border")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
