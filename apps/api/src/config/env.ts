import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Auth (plan §13.3): session cookie lifetime, whether it requires HTTPS,
  // the dev-only Origin allow-list, and how many reverse-proxy hops to
  // trust for req.ip (0 locally, 1 behind nginx, 2 behind Netlify->Render).
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // z.coerce.boolean() is a trap here: Boolean("false") is true. Parse the
  // string explicitly instead.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {}

// Pure and synchronous on purpose: the only place allowed to exit the
// process is the server entrypoint, so this stays unit-testable.
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new EnvValidationError(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
