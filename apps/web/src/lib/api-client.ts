// Every request goes through here so error-code -> message mapping (plan
// §12.3) and 401 handling live in exactly one place, not once per screen.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    /** From the `Retry-After` header on 429/503 responses (plan §12.3) — seconds, when the server sent one. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

// Only the codes a passenger screen can actually hit in this session; the
// server's own message is used verbatim for anything not listed here.
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "Please check the highlighted fields.",
  UNAUTHENTICATED: "Please sign in to continue.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  FORBIDDEN: "This area is for a different role.",
  NOT_FOUND: "We couldn't find that ride.",
  EMAIL_TAKEN: "That email already has an account.",
  RATE_LIMITED: "Too many attempts. Try again in a moment.",
  ACTIVE_RIDE_EXISTS: "You already have a ride in progress.",
  REQUEST_NOT_OPEN: "This ride was already matched or cancelled.",
  CANCELLATION_NOT_ALLOWED: "Your ride has already started and can't be cancelled.",
  INSUFFICIENT_BALANCE:
    "Your TeslaPay balance is too low for this fare — top up or pay cash instead.",
  POOL_CAPACITY_EXCEEDED: "That seat was just taken. Here are the current options.",
  POOL_NOT_ACCEPTING: "This Tesla is no longer taking passengers.",
  POOL_INCOMPATIBLE: "This Tesla's route no longer suits your trip.",
  INVALID_TRANSITION: "The ride has moved on — refreshing.",
  SERVICE_UNAVAILABLE: "We can't reach the server. Retry.",
  SERVICE_BUSY: "Busy right now — retrying…",
  INTERNAL_ERROR: "Unexpected error. Please try again.",
};

export function messageForError(code: string, fallback: string): string {
  return ERROR_MESSAGES[code] ?? fallback;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | undefined;

// Set once from the router/auth layer (plan §15.3: "401 -> stop all
// polling, redirect to login"); the client itself has no router dependency.
export function onUnauthorized(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string; details?: Record<string, unknown> };
}

interface RequestConfig {
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function send(path: string, config: RequestConfig): Promise<unknown> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (config.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(config.body);
  }
  if (config.idempotencyKey) {
    headers["Idempotency-Key"] = config.idempotencyKey;
  }

  const res = await fetch(`/api/v1${path}`, {
    method: config.method ?? "GET",
    headers,
    body,
    credentials: "include",
    signal: config.signal,
  });

  if (res.status === 401) {
    unauthorizedHandler?.();
  }
  if (res.status === 204) {
    return undefined;
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const envelope = json as ErrorEnvelope | null;
    const err = envelope?.error;
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    throw new ApiError(
      res.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message ?? "Something went wrong.",
      err?.details,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    );
  }

  return json;
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null };
}

export const api = {
  get: async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const json = (await send(path, { method: "GET", signal })) as { data: T };
    return json.data;
  },
  getPage: async <T>(path: string, signal?: AbortSignal): Promise<Page<T>> => {
    return (await send(path, { method: "GET", signal })) as Page<T>;
  },
  post: async <T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> => {
    const json = (await send(path, { method: "POST", body, idempotencyKey })) as { data: T };
    return json.data;
  },
  postNoContent: async (path: string, body?: unknown): Promise<void> => {
    await send(path, { method: "POST", body });
  },
};
