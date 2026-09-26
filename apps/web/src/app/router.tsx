import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth-context.js";
import { AppLayout } from "./AppLayout.js";
import { LoginPage } from "../features/auth/LoginPage.js";
import { RegisterPage } from "../features/auth/RegisterPage.js";
import { PassengerHomePage } from "../features/passenger/PassengerHomePage.js";
import { RidePage } from "../features/passenger/RidePage.js";
import { HistoryPage } from "../features/passenger/HistoryPage.js";

function FullPageSpinner() {
  return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">Loading…</div>;
}

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

function RedirectIfLoggedIn({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <FullPageSpinner />;
  }
  if (user) {
    return <Navigate to="/p" replace />;
  }
  return children;
}

export function AppRouter() {
  return (
    <Routes>
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

      <Route path="*" element={<Navigate to="/p" replace />} />
    </Routes>
  );
}
