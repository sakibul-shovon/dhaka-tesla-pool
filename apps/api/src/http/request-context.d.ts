import type { AuthenticatedUser } from "../modules/auth/session-service.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Raw session token for this request, set alongside `user` by `authenticate`. */
      sessionToken?: string;
    }
  }
}

export {};
