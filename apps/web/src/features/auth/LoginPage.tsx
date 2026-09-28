import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { useRetryCountdown } from "../../lib/useRetryCountdown.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Input } from "../../components/ui/Input.js";
import { PasswordInput } from "../../components/ui/PasswordInput.js";
import { Button } from "../../components/ui/Button.js";
import { useToast } from "../../components/ui/Toast.js";
import { AuthSplitLayout } from "./AuthSplitLayout.js";
import type { User } from "../../lib/types.js";

// Only the email, never the password — sessionStorage isn't encrypted and
// a password has no business surviving a tab reload. This exists because
// a backgrounded tab can lose all in-memory state to the browser's own
// memory-saving discard-and-reload behavior; it's a draft, not real
// persistence, so it's cleared the moment login actually succeeds.
const EMAIL_DRAFT_KEY = "dtp-login-email-draft";

function readEmailDraft(): string {
  try {
    return sessionStorage.getItem(EMAIL_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeEmailDraft(value: string): void {
  try {
    sessionStorage.setItem(EMAIL_DRAFT_KEY, value);
  } catch {
    // Best-effort only — the field still works for this page view.
  }
}

function clearEmailDraft(): void {
  try {
    sessionStorage.removeItem(EMAIL_DRAFT_KEY);
  } catch {
    // Nothing to clean up if storage was never writable.
  }
}

export function LoginPage() {
  const [email, setEmail] = useState(readEmailDraft);
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const justRegistered =
    (location.state as { justRegistered?: boolean } | null)?.justRegistered ?? false;

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
      clearEmailDraft();
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
    <AuthSplitLayout>
      <h1 className="font-display text-2xl font-bold text-text">Welcome back</h1>
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
            onChange={(event) => {
              setEmail(event.target.value);
              writeEmailDraft(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-text">
            Password
          </label>
          <PasswordInput
            id="password"
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

        <Button
          type="submit"
          disabled={login.isPending || Boolean(retrySeconds)}
          className="w-full"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-text-muted">
        New here?{" "}
        <Link to="/register" className="font-medium text-accent-strong hover:underline">
          Create an account
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
