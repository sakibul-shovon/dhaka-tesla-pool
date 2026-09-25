import express, { type Express } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type pino from "pino";
import { ERROR_CODES } from "@dhaka-tesla-pool/shared";
import { errorMapper } from "./http/error-mapper.js";
import { healthRouter } from "./modules/health/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { zonesRouter } from "./modules/zones/routes.js";
import { faresRouter } from "./modules/fares/routes.js";
import { ridesRouter } from "./modules/rides/routes.js";
import { driverRouter } from "./modules/driver/routes.js";
import { originGuard } from "./http/middleware/origin-guard.js";
import { createDb } from "./db/client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

export interface AppDeps {
  pool: Pool;
  logger: pino.Logger;
  sessionTtlHours: number;
  cookieSecure: boolean;
  webOrigin?: string;
  trustProxy?: number;
}

// No listen() here — kept separate from server.ts so tests can build and
// exercise the app without binding a port (plan §4.3).
export function buildApp({
  pool,
  logger,
  sessionTtlHours,
  cookieSecure,
  webOrigin = "http://localhost:5173",
  trustProxy = 0,
}: AppDeps): Express {
  const app = express();
  const db = createDb(pool);

  app.set("trust proxy", trustProxy);

  app.disable("x-powered-by");
  app.disable("etag");

  app.use(helmet());

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && UUID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      serializers: { req: (req) => ({ method: req.method, url: req.url }) },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(originGuard([webOrigin]));

  app.use((req, res, next) => {
    const hasBody = req.headers["content-length"] && req.headers["content-length"] !== "0";
    if (MUTATING_METHODS.has(req.method) && hasBody && !req.is("application/json")) {
      res.status(415).json({
        error: {
          code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
          message: "Content-Type must be application/json.",
          requestId: req.id,
        },
      });
      return;
    }
    next();
  });

  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());

  app.use("/api/v1", healthRouter(pool));
  app.use("/api/v1/auth", authRouter({ db, sessionTtlHours, cookieSecure }));
  app.use("/api/v1/zones", zonesRouter(db));
  app.use("/api/v1/fare-quotes", faresRouter(db));
  app.use("/api/v1/ride-requests", ridesRouter(db));
  app.use("/api/v1/driver", driverRouter(db));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: ERROR_CODES.NOT_FOUND, message: "Not found", requestId: req.id },
    });
  });

  app.use(errorMapper);

  return app;
}
