import { Router } from "express";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import type { Db } from "../../db/client.js";
import { HttpError } from "../../http/error-mapper.js";
import { sendData } from "../../http/response.js";
import { authenticate } from "../../http/middleware/authenticate.js";
import { hashPassword, verifyPassword } from "./password-service.js";
import { createPassengerUser, findUserByEmail, type UserRow } from "./repository.js";
import { loginSchema, registerSchema } from "./schemas.js";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from "./session-service.js";

export interface AuthRouterDeps {
  db: Db;
  sessionTtlHours: number;
  cookieSecure: boolean;
}

function toPublicUser(user: Pick<UserRow, "id" | "name" | "email" | "role" | "status">) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
}

function validationError(details: Record<string, unknown>): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid request body.", details);
}

export function authRouter({ db, sessionTtlHours, cookieSecure }: AuthRouterDeps): Router {
  const router = Router();
  const requireAuth = authenticate(db);

  router.post("/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }
      const existing = await findUserByEmail(db, parsed.data.email);
      if (existing) {
        next(new HttpError(409, ERROR_CODES.EMAIL_TAKEN, "That email already has an account."));
        return;
      }
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await createPassengerUser(db, {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
      });
      sendData(res, 201, toPublicUser(user));
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError({ fields: parsed.error.flatten().fieldErrors }));
        return;
      }
      const user = await findUserByEmail(db, parsed.data.email);
      const passwordOk = await verifyPassword(user?.passwordHash, parsed.data.password);
      if (!user || !passwordOk || user.status !== "ACTIVE") {
        next(new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, "Email or password is incorrect."));
        return;
      }
      const { token, expiresAt } = await createSession(db, user.id, sessionTtlHours);
      setSessionCookie(res, token, expiresAt, cookieSecure);
      sendData(res, 200, toPublicUser(user));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", requireAuth, async (req, res, next) => {
    try {
      await revokeSession(db, req.sessionToken!);
      clearSessionCookie(res, cookieSecure);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", requireAuth, (req, res) => {
    sendData(res, 200, toPublicUser(req.user!));
  });

  return router;
}
