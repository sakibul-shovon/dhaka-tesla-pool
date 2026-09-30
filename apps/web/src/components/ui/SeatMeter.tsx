import { motion } from "motion/react";
import { User } from "lucide-react";

// plan §15.2's own shorthand for this exact meter: "●●○ 2/3 seats" — now
// drawn as filled/outline seat icons instead of dots. `size="lg"` is the
// driver pool page's "large seat meter" (plan round 3 §3) — same shape,
// bigger cells, so it reads as the pool's headline number rather than a
// footnote.
export function SeatMeter({
  capacity,
  reserved,
  size = "md",
}: {
  capacity: number;
  reserved: number;
  size?: "md" | "lg";
}) {
  const seats = Array.from({ length: capacity }, (_, index) => index < reserved);
  const cellClass = size === "lg" ? "h-10 w-10 rounded-xl" : "h-7 w-7 rounded-lg";
  const iconSize = size === "lg" ? 18 : 14;

  return (
    <div
      className="flex items-center gap-2.5"
      aria-label={`${reserved} of ${capacity} seats occupied`}
    >
      <div className="flex gap-1.5">
        {seats.map((filled, index) => (
          <motion.span
            key={index}
            aria-hidden
            // Pops once when a seat actually fills (plan round 3 §4) — the
            // keyframe target only changes shape on the false->true edge, so
            // vacating a seat (no-show, cancel) just settles back to scale 1
            // instead of popping again.
            animate={{ scale: filled ? [0.7, 1.12, 1] : 1 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className={
              `flex items-center justify-center border transition-colors ${cellClass} ` +
              (filled
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border-strong bg-surface-raised text-text-faint")
            }
          >
            <User size={iconSize} strokeWidth={2.25} fill={filled ? "currentColor" : "none"} />
          </motion.span>
        ))}
      </div>
      <span
        className={
          size === "lg"
            ? "tabular text-lg font-semibold text-text"
            : "tabular text-sm text-text-muted"
        }
      >
        {reserved}/{capacity} seats
      </span>
    </div>
  );
}
