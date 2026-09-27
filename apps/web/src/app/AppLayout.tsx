import { useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Car, Clock, LogOut, Menu, Users, Wallet, X, Zap } from "lucide-react";
import { api } from "../lib/api-client.js";
import { useAuth } from "./auth-context.js";
import { homePathForRole } from "./roles.js";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  end?: boolean;
}

function navItemsForRole(role: string | undefined): NavItem[] {
  if (role === "DRIVER") {
    return [
      { to: "/d", label: "Dashboard", Icon: Car, end: true },
      { to: "/d/history", label: "History", Icon: Clock },
    ];
  }
  if (role === "ADMIN") {
    return [{ to: "/a", label: "Drivers", Icon: Users, end: true }];
  }
  return [
    { to: "/p", label: "Ride", Icon: Car, end: true },
    { to: "/p/wallet", label: "Wallet", Icon: Wallet },
    { to: "/p/history", label: "History", Icon: Clock },
  ];
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
  (isActive
    ? "bg-accent-soft text-accent-strong"
    : "text-text-muted hover:bg-surface-raised hover:text-text");

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors " +
  (isActive
    ? "bg-accent-soft text-accent-strong"
    : "text-text-muted hover:bg-surface-raised hover:text-text");

function getInitials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(location.pathname);
  const navItems = navItemsForRole(user?.role);

  // A route change is the one unambiguous "the user is done with the menu"
  // signal. Adjusted during render (React's documented pattern for resetting
  // state when a prop changes) rather than in an effect, which would cause
  // an extra render pass and trips the set-state-in-effect lint rule.
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    setMobileOpen(false);
  }

  const logout = useMutation({
    mutationFn: () => api.postNoContent("/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], undefined);
      queryClient.clear();
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-20 flex-none border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to={homePathForRole(user?.role ?? "PASSENGER")}
            className="flex items-center gap-2 font-display font-semibold text-text"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Zap size={16} strokeWidth={2.5} fill="currentColor" />
            </span>
            Dhaka Tesla Pool
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {navItems.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClass}>
                <Icon size={15} strokeWidth={2.25} />
                {label}
              </NavLink>
            ))}
            <ThemeToggle className="ml-1" />
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

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-raised hover:text-text md:hidden"
          >
            {mobileOpen ? (
              <X size={20} strokeWidth={2.25} />
            ) : (
              <Menu size={20} strokeWidth={2.25} />
            )}
          </button>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.nav
              id="mobile-nav"
              aria-label="Primary"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden border-t border-border bg-bg md:hidden"
            >
              <div className="flex flex-col gap-1 px-4 py-3">
                {navItems.map(({ to, label, Icon, end }) => (
                  <NavLink key={to} to={to} end={end} className={mobileNavLinkClass}>
                    <Icon size={16} strokeWidth={2.25} />
                    {label}
                  </NavLink>
                ))}
                <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                  <span className="flex items-center gap-2 text-sm text-text-muted">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-text-muted">
                      {getInitials(user?.name)}
                    </span>
                    {user?.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <ThemeToggle />
                    <button
                      type="button"
                      onClick={() => logout.mutate()}
                      disabled={logout.isPending}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:opacity-50"
                    >
                      <LogOut size={15} strokeWidth={2.25} />
                      Sign out
                    </button>
                  </div>
                </div>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>
      {/* Full-bleed on purpose (plan round 3 §2/§3) — every page picks its own
          template (Workspace or PageContainer) instead of main imposing one
          width for both a map-filled workspace and a centred content page. */}
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
