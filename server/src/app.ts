import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { type RateLimitConfig, createRateLimiters } from "./lib/rateLimit.js";
import { createAuthRouter } from "./routes/auth.js";
import { createChatRouter } from "./routes/chat.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createMeRouter } from "./routes/me.js";
import { createQuizzesRouter } from "./routes/quizzes.js";
import { createRoomsRouter } from "./routes/rooms.js";
import { createScheduleRouter } from "./routes/schedule.js";

export interface AppOptions {
  /** Override individual rate limits (tests use this to exercise them quickly). */
  rateLimits?: Partial<RateLimitConfig>;
  /** Extra routes, mounted after the API but before the 404 and error handlers. */
  extraRoutes?: (app: Express) => void;
}

export function createApp(options: AppOptions = {}): Express {
  const config = getConfig();
  const app = express();

  // In production, requests reach us through proxies (Vercel's rewrite for REST, then Render's
  // Cloudflare edge and load balancer) that add X-Forwarded-For. TRUST_PROXY decides what
  // req.ip is; the client address used for rate limits is worked out in lib/rateLimit.ts.
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
  app.use("/rooms", createChatRouter(limits));
  app.use("/me", createMeRouter(limits));
  app.use(createScheduleRouter(limits)); // /rooms/:roomId/schedule and /schedule/upcoming

  options.extraRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
