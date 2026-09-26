import { Link, NavLink, Outlet } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.js";
import { useAuth } from "./auth-context.js";
import { homePathForRole } from "./roles.js";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "rounded px-3 py-1.5 text-sm font-medium " + (isActive ? "bg-amber-50 text-amber-700" : "text-neutral-600 hover:text-neutral-900");

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
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to={homePathForRole(user?.role ?? "PASSENGER")} className="font-bold text-neutral-900">
            Dhaka Tesla Pool
          </Link>
          <nav className="flex items-center gap-1">
            {user?.role === "DRIVER" && (
              <>
                <NavLink to="/d" end className={navLinkClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/d/history" className={navLinkClass}>
                  History
                </NavLink>
              </>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/a" end className={navLinkClass}>
                Drivers
              </NavLink>
            )}
            {user?.role === "PASSENGER" && (
              <>
                <NavLink to="/p" end className={navLinkClass}>
                  Ride
                </NavLink>
                <NavLink to="/p/history" className={navLinkClass}>
                  History
                </NavLink>
              </>
            )}
            <span className="mx-2 text-sm text-neutral-400">{user?.name}</span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="rounded px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
            >
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
