import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAME, verifyAuthToken } from "../lib/auth.js";
import { prisma } from "../db.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  const payload = typeof token === "string" ? verifyAuthToken(token) : null;

  if (!payload) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  req.user = { id: user.id, email: user.email, displayName: user.displayName };
  next();
}
