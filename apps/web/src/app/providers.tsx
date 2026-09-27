import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { AuthProvider } from "./auth-context.js";
import { ToastProvider } from "../components/ui/Toast.js";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
          },
          mutations: {
            // Never auto-retried (plan §15.4) — a retry is always the user
            // pressing a button again, reusing the same idempotency key.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Global once, per redesign plan §8 — every Motion animation in the
          app should respect the OS reduced-motion setting without each
          component having to opt in individually. */}
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
