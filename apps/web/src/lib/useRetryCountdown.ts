import { useEffect, useState } from "react";
import { ApiError } from "./api-client.js";

// Ticks down from the server's Retry-After on a 429 (plan: "rate-limit
// countdown surfaced clearly") instead of leaving the user to guess how
// long "in a moment" actually is.
export function useRetryCountdown(error: unknown): number | undefined {
  const initialSeconds = error instanceof ApiError && error.code === "RATE_LIMITED" ? error.retryAfterSeconds : undefined;
  const [remaining, setRemaining] = useState(initialSeconds);
  const [lastInitialSeconds, setLastInitialSeconds] = useState(initialSeconds);

  // A new rate-limited error resets the countdown. Adjusted during render
  // (React's documented pattern for resetting state when a prop changes)
  // rather than in an effect, which would trip the set-state-in-effect rule.
  if (initialSeconds !== lastInitialSeconds) {
    setLastInitialSeconds(initialSeconds);
    setRemaining(initialSeconds);
  }

  useEffect(() => {
    if (!remaining) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => (current && current > 1 ? current - 1 : undefined));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  return remaining;
}
