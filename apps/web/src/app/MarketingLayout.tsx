import { Link, Outlet } from "react-router-dom";
import { Zap } from "lucide-react";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";

// The public-facing shell (landing page today) — distinct from AppLayout,
// which assumes an authenticated user and role-based nav. This one only
// ever offers Sign in / Get started.
export function MarketingLayout() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-display font-semibold text-text">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Zap size={16} strokeWidth={2.5} fill="currentColor" />
            </span>
            Dhaka Tesla Pool
          </Link>
          <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Primary">
            <ThemeToggle />
            <Link
              to="/login"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-on-accent transition-[filter] hover:brightness-95"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-8 text-center sm:px-6 lg:px-8">
          <span className="flex items-center gap-2 font-display text-sm font-semibold text-text">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-on-accent">
              <Zap size={13} strokeWidth={2.5} fill="currentColor" />
            </span>
            Dhaka Tesla Pool
          </span>
          <p className="text-xs text-text-faint">
            Share a seat. Split the fare. Survive Dhaka traffic.
          </p>
        </div>
      </footer>
    </div>
  );
}
