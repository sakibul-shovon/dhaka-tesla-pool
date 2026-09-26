import { User } from "lucide-react";

// plan §15.2's own shorthand for this exact meter: "●●○ 2/3 seats" — now
// drawn as filled/outline seat icons instead of dots.
export function SeatMeter({ capacity, reserved }: { capacity: number; reserved: number }) {
  const seats = Array.from({ length: capacity }, (_, index) => index < reserved);

  return (
    <div className="flex items-center gap-2.5" aria-label={`${reserved} of ${capacity} seats occupied`}>
      <div className="flex gap-1.5">
        {seats.map((filled, index) => (
          <span
            key={index}
            aria-hidden
            className={
              "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors " +
              (filled
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border-strong bg-surface-raised text-text-faint")
            }
          >
            <User size={14} strokeWidth={2.25} fill={filled ? "currentColor" : "none"} />
          </span>
        ))}
      </div>
      <span className="tabular text-sm text-text-muted">
        {reserved}/{capacity} seats
      </span>
    </div>
  );
}
