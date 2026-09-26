import type { ErrorRequestHandler, Request, Response } from "express";
import { ERROR_CODES, type ErrorCode } from "@dhaka-tesla-pool/shared";

// The one place allowed to put an error on the wire (plan §12.1, §13.1
// API8): never leak a stack trace or raw driver error to the client.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    /** Seconds for a `Retry-After` header (plan §10.3's `SERVICE_BUSY`) — never part of the JSON body. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function requestId(req: Request, res: Response): string | undefined {
  return req.id?.toString() ?? (res.getHeader("X-Request-Id") as string | undefined);
}

function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  requestIdValue: string | undefined,
  details?: Record<string, unknown>,
): void {
  res.status(status).json({
    error: { code, message, requestId: requestIdValue, ...(details ? { details } : {}) },
  });
}

function isPayloadTooLarge(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.too.large";
}

function isMalformedJson(err: unknown): boolean {
  return err instanceof SyntaxError && (err as { type?: string }).type === "entity.parse.failed";
}

export const errorMapper: ErrorRequestHandler = (err, req, res, _next) => {
  const id = requestId(req, res);

  if (err instanceof HttpError) {
    if (err.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
    }
    sendError(res, err.status, err.code, err.message, id, err.details);
    return;
  }
  if (isPayloadTooLarge(err)) {
    sendError(res, 413, ERROR_CODES.PAYLOAD_TOO_LARGE, "Request body exceeds the size limit.", id);
    return;
  }
  if (isMalformedJson(err)) {
    sendError(res, 400, ERROR_CODES.VALIDATION_FAILED, "Malformed JSON body.", id);
    return;
  }

  req.log?.error({ err }, "unhandled error");
  sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, `Unexpected error. Reference: ${id}`, id);
};
