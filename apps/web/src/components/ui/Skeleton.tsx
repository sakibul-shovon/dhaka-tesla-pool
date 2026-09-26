// A single placeholder block using the shimmer keyframe from index.css.
// Compose several of these to mirror the shape of the real content
// (plan: skeletons should be shaped like what they'll become, not a generic
// spinner) — see Uber's own price-skeleton pattern from the design research.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-shimmer rounded-lg ${className}`} aria-hidden />;
}
