import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { useRetryCountdown } from "../../lib/useRetryCountdown.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Button } from "../../components/ui/Button.js";
import { useToast } from "../../components/ui/Toast.js";
import type { User } from "../../lib/types.js";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const justRegistered = (location.state as { justRegistered?: boolean } | null)?.justRegistered ?? false;

  useEffect(() => {
    if (justRegistered) {
      showToast({ message: "Account created — sign in below.", tone: "success" });
    }
    // Fire once for the arrival that carried this state, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useMutation({
    mutationFn: () => api.post<User>("/auth/login", { email, password }),
    onSuccess: (user) => {
      queryClient.setQueryData(["auth", "me"], user);
      navigate("/p", { replace: true });
    },
  });

  const retrySeconds = useRetryCountdown(login.error);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <Link to="/" className="mx-auto mb-6 flex items-center gap-2 font-display font-semibold text-text">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
          <Zap size={17} strokeWidth={2.5} fill="currentColor" />
        </span>
        Dhaka Tesla Pool
      </Link>

      <Card>
        <h1 className="font-display text-xl font-bold text-text">Welcome back</h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to request or manage your ride.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-text">
              Email
            </label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-text">
              Password
            </label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {login.isError && (
            <ErrorBanner
              message={
                retrySeconds
                  ? `Too many attempts. Try again in ${retrySeconds}s.`
                  : login.error instanceof ApiError
                    ? messageForError(login.error.code, login.error.message)
                    : "Something went wrong."
              }
            />
          )}

          <Button type="submit" disabled={login.isPending || Boolean(retrySeconds)} className="w-full">
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-text-muted">
        New here?{" "}
        <Link to="/register" className="font-medium text-accent-strong hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
