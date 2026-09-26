import { Link, NavLink, Outlet } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Clock, LogOut, Zap } from "lucide-react";
import { api } from "../lib/api-client.js";
import { useAuth } from "./auth-context.js";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
  (isActive ? "bg-accent-soft text-accent-strong" : "text-text-muted hover:bg-surface-raised hover:text-text");

function getInitials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function AppLayout() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api.postNoContent("/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], undefined);
      queryClient.clear();
    },
  });

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            to={user?.role === "DRIVER" ? "/d" : "/p"}
            className="flex items-center gap-2 font-display font-semibold text-text"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
              <Zap size={16} strokeWidth={2.5} fill="currentColor" />
            </span>
            Dhaka Tesla Pool
          </Link>
          <nav className="flex items-center gap-1">
            {user?.role === "DRIVER" ? (
              <>
                <NavLink to="/d" end className={navLinkClass}>
                  <Car size={15} strokeWidth={2.25} />
                  Dashboard
                </NavLink>
                <NavLink to="/d/history" className={navLinkClass}>
                  <Clock size={15} strokeWidth={2.25} />
                  History
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/p" end className={navLinkClass}>
                  <Car size={15} strokeWidth={2.25} />
                  Ride
                </NavLink>
                <NavLink to="/p/history" className={navLinkClass}>
                  <Clock size={15} strokeWidth={2.25} />
                  History
                </NavLink>
              </>
            )}
            <span
              className="mx-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-text-muted"
              title={user?.name}
            >
              {getInitials(user?.name)}
            </span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:opacity-50"
            >
              <LogOut size={15} strokeWidth={2.25} />
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
