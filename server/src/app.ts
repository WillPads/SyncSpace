import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { type RateLimitConfig, createRateLimiters } from "./lib/rateLimit.js";
import { createAuthRouter } from "./routes/auth.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createQuizzesRouter } from "./routes/quizzes.js";
import { createRoomsRouter } from "./routes/rooms.js";

export interface AppOptions {
  /** Override individual rate limits (tests use this to exercise them quickly). */
  rateLimits?: Partial<RateLimitConfig>;
  /** Extra routes, mounted after the API but before the 404 and error handlers. */
  extraRoutes?: (app: Express) => void;
}

export function createApp(options: AppOptions = {}): Express {
  const config = getConfig();
  const app = express();

  // In production, requests reach us through proxies (Vercel's rewrite, then Render's load
  // balancer) that terminate TLS and add X-Forwarded-For. How many hops to trust is
  // TRUST_PROXY; it decides what req.ip (used for rate limits) is.
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  // Every response is per-user and live; nothing in between should cache it.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Readiness: also checks the database (not used as Render's health check, so a database
  // blip doesn't get the whole service restarted).
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });

  const limits = createRateLimiters(options.rateLimits);
  app.use("/auth", createAuthRouter(limits));
  app.use("/rooms", createRoomsRouter(limits));
  app.use("/rooms", createDocumentsRouter(limits));
  app.use("/rooms", createQuizzesRouter());

  options.extraRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
