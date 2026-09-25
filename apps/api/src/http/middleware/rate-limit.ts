import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";

const WINDOW_MS = 15 * 60 * 1000;

function rateLimitedHandler(req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: "Too many attempts. Try again later.",
      requestId: req.id,
    },
  });
}

const commonOptions: Partial<Options> = {
  windowMs: WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
};

// Plan §13.1: 5 attempts / 15 min per (IP, email) — the tighter, more
// specific bound that actually slows down credential stuffing against one
// account.
export const loginPerIpEmailLimiter = rateLimit({
  ...commonOptions,
  limit: 5,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
  },
});

// Plan §13.1: 30 / 15 min per IP — the broader backstop against one IP
// spraying many different emails.
export const loginPerIpLimiter = rateLimit({ ...commonOptions, limit: 30 });

// Not given an exact number in the plan; a conservative default of the same
// order of magnitude, documented here rather than left unbounded.
export const registerPerIpLimiter = rateLimit({ ...commonOptions, limit: 10 });
