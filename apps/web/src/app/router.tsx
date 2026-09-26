import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth-context.js";
import { AppLayout } from "./AppLayout.js";
import { MarketingLayout } from "./MarketingLayout.js";
import { homePathForRole } from "./roles.js";
import { FullPageSpinner } from "../components/ui/Spinner.js";
import { LoginPage } from "../features/auth/LoginPage.js";
import { RegisterPage } from "../features/auth/RegisterPage.js";
import { PassengerHomePage } from "../features/passenger/PassengerHomePage.js";
import { RidePage } from "../features/passenger/RidePage.js";
import { HistoryPage } from "../features/passenger/HistoryPage.js";
import { DriverDashboardPage } from "../features/driver/DriverDashboardPage.js";
import { DriverPoolPage } from "../features/driver/DriverPoolPage.js";
import { DriverHistoryPage } from "../features/driver/DriverHistoryPage.js";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage.js";

// Lazy so GSAP (landing-page-only, per the redesign plan §8) never ships in
// the bundle for the authenticated app — this is its own chunk, fetched
// only when a visitor actually lands on "/".
const LandingPage = lazy(() =>
  import("../features/marketing/LandingPage.js").then((module) => ({ default: module.LandingPage })),
);

// Role checks here are UX only (plan §15.1) — the API enforces the real
// authorization on every request regardless of what this component decides.
function RequirePassenger({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "PASSENGER") {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireDriver({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "DRIVER") {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "ADMIN") {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RootRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return <Navigate to={homePathForRole(user.role)} replace />;
}

function RedirectIfLoggedIn({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }
  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RedirectIfLoggedIn>
            <MarketingLayout />
          </RedirectIfLoggedIn>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <LandingPage />
            </Suspense>
          }
        />
      </Route>
      <Route
        path="/login"
        element={
          <RedirectIfLoggedIn>
            <LoginPage />
          </RedirectIfLoggedIn>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfLoggedIn>
            <RegisterPage />
          </RedirectIfLoggedIn>
        }
      />

      <Route
        path="/p"
        element={
          <RequirePassenger>
            <AppLayout />
          </RequirePassenger>
        }
      >
        <Route index element={<PassengerHomePage />} />
        <Route path="rides/:id" element={<RidePage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>

      <Route
        path="/d"
        element={
          <RequireDriver>
            <AppLayout />
          </RequireDriver>
        }
      >
        <Route index element={<DriverDashboardPage />} />
        <Route path="pools/:id" element={<DriverPoolPage />} />
        <Route path="history" element={<DriverHistoryPage />} />
      </Route>

      <Route
        path="/a"
        element={
          <RequireAdmin>
            <AppLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboardPage />} />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
