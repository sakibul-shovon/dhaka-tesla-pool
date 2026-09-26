import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  // Public registration always creates a PASSENGER (plan §13.1) — there is
  // no role field on this form, not even a hidden one.
  const register = useMutation({
    mutationFn: () => api.post("/auth/register", { name, email, password }),
    onSuccess: () => {
      navigate("/login", { replace: true, state: { justRegistered: true } });
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    register.mutate();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-neutral-900">Create your account</h1>
      <p className="mt-1 text-sm text-neutral-500">Passenger accounts only — drivers are provisioned separately.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-neutral-700">
          Name
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-neutral-400">At least 8 characters.</span>
        </label>

        {register.isError && (
          <ErrorBanner
            message={
              register.error instanceof ApiError
                ? messageForError(register.error.code, register.error.message)
                : "Something went wrong."
            }
          />
        )}

        <button
          type="submit"
          disabled={register.isPending}
          className="w-full rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {register.isPending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
