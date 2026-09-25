import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { resolveSession, SESSION_COOKIE_NAME } from "../../modules/auth/session-service.js";
import { HttpError } from "../error-mapper.js";

// Attaches req.user / req.sessionToken, or rejects with 401. Session role is
// read from the DB on every request — never trusted from the client.
export function authenticate(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== "string" || token.length === 0) {
      next(new HttpError(401, ERROR_CODES.UNAUTHENTICATED, "Sign in required."));
      return;
    }
    const user = await resolveSession(db, token);
    if (!user) {
      next(new HttpError(401, ERROR_CODES.UNAUTHENTICATED, "Session expired or revoked."));
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  };
}
