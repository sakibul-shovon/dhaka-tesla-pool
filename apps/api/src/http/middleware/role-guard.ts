import type { RequestHandler } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import { HttpError } from "../error-mapper.js";
import type { AuthenticatedUser } from "../../modules/auth/session-service.js";

// Mount after `authenticate` — role comes from the session the DB just
// resolved, never from anything the client sent on this request.
export function requireRole(role: AuthenticatedUser["role"]): RequestHandler {
  return (req, _res, next) => {
    if (req.user?.role !== role) {
      next(new HttpError(403, ERROR_CODES.FORBIDDEN, "This area is for a different role."));
      return;
    }
    next();
  };
}
