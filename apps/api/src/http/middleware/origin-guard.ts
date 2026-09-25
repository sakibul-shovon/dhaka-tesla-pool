import type { RequestHandler } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import { HttpError } from "../error-mapper.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Defence-in-depth alongside the SameSite=Lax session cookie (plan §13.1
// CSRF row): a cross-origin fetch/XHR always sends Origin, so reject one
// that isn't allow-listed. A same-origin request that omits Origin (some
// non-browser clients, older browsers) is let through — the cookie's
// SameSite attribute is what actually stops a forged cross-site request.
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      next(new HttpError(403, ERROR_CODES.FORBIDDEN, "Origin not allowed."));
      return;
    }
    next();
  };
}
