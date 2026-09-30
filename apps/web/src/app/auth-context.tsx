import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, onUnauthorized } from "../lib/api-client.js";
import type { User } from "../lib/types.js";

interface AuthState {
  user: User | undefined;
  isLoading: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<User>("/auth/me"),
    retry: false,
    staleTime: Infinity,
    // A logged-out visitor's query holds no data, and Query treats no data
    // as stale regardless of staleTime — so the app-wide refetch-on-focus
    // re-ran this check on every return to the tab. Re-running it resets the
    // query to its initial loading state, the route guards swap the page
    // for a spinner, and the login/register form unmounts and loses what was
    // typed. Nothing is lost by opting out: an expired session is still
    // caught by the very next API call's 401 (onUnauthorized below).
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    // Plan §15.4: "401 -> stop all polling, redirect to login." A hard
    // redirect (not client-side navigation) is deliberate here — it's the
    // one guaranteed way to kill every in-flight poll interval at once, and
    // this only fires for a session that *was* authenticated and expired
    // mid-use, not for the first /auth/me check on a fresh visit.
    onUnauthorized(() => {
      const hadUser = queryClient.getQueryData(["auth", "me"]) !== undefined;
      if (hadUser && window.location.pathname !== "/login") {
        queryClient.clear();
        window.location.assign("/login");
      }
    });
  }, [queryClient]);

  return <AuthContext.Provider value={{ user, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
