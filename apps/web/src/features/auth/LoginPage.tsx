import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import type { User } from "../../lib/types.js";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const justRegistered = (location.state as { justRegistered?: boolean } | null)?.justRegistered ?? false;

  const login = useMutation({
    mutationFn: () => api.post<User>("/auth/login", { email, password }),
    onSuccess: (user) => {
      queryClient.setQueryData(["auth", "me"], user);
      navigate("/p", { replace: true });
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-neutral-900">Dhaka Tesla Pool</h1>
      <p className="mt-1 text-sm text-neutral-500">Share a seat. Split the fare.</p>

      {justRegistered && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Account created — sign in below.
        </p>
      )}

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-neutral-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm text-neutral-700">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        {login.isError && (
          <ErrorBanner
            message={
              login.error instanceof ApiError
                ? messageForError(login.error.code, login.error.message)
                : "Something went wrong."
            }
          />
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded bg-[--color-accent] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-neutral-500">
        New here?{" "}
        <Link to="/register" className="font-medium text-[--color-accent] underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
