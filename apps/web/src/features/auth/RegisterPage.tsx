import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { api, ApiError, messageForError } from "../../lib/api-client.js";
import { useRetryCountdown } from "../../lib/useRetryCountdown.js";
import { ErrorBanner } from "../../components/ui/ErrorBanner.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Button } from "../../components/ui/Button.js";

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

  const retrySeconds = useRetryCountdown(register.error);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    register.mutate();
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
        <h1 className="font-display text-xl font-bold text-text">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">Passenger accounts only — drivers are provisioned separately.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-sm font-medium text-text">
              Name
            </label>
            <Input id="name" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="register-email" className="block text-sm font-medium text-text">
              Email
            </label>
            <Input
              id="register-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="register-password" className="block text-sm font-medium text-text">
              Password
            </label>
            <Input
              id="register-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-xs text-text-faint">At least 8 characters.</p>
          </div>

          {register.isError && (
            <ErrorBanner
              message={
                retrySeconds
                  ? `Too many attempts. Try again in ${retrySeconds}s.`
                  : register.error instanceof ApiError
                    ? messageForError(register.error.code, register.error.message)
                    : "Something went wrong."
              }
            />
          )}

          <Button type="submit" disabled={register.isPending || Boolean(retrySeconds)} className="w-full">
            {register.isPending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent-strong hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
