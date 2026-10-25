import type { NextFunction, Request, Response } from "express";
import {
  type AuthenticatedUser,
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  setSessionCookie,
  validateSession,
} from "../lib/auth.js";
import { HttpError } from "../lib/http.js";

export type { AuthenticatedUser };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    /** The database session behind this request's cookie. */
    authSession?: { id: string; expiresAt: Date };
  }
}

export function sessionTokenFrom(req: Request): string | null {
  const token: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = sessionTokenFrom(req);
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Not authenticated.");

  const result = await validateSession(token);
  if (!result) {
    // Expired or revoked: drop the dead cookie so the browser stops sending it.
    clearSessionCookie(res);
    throw new HttpError(401, "UNAUTHENTICATED", "Not authenticated.");
  }
  if (result.renewed) setSessionCookie(res, token);

  req.user = result.user;
  req.authSession = { id: result.session.id, expiresAt: result.session.expiresAt };
  next();
}
