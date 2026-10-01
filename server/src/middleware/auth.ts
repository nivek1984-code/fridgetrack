import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../http.js";

export interface AuthUser {
  id: string;
  householdId: string;
  role: "ADMIN" | "MEMBER";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = "ft_token";
const secret = () => process.env.JWT_SECRET || "dev-only-secret";

export function signToken(user: AuthUser) {
  return jwt.sign(user, secret(), { expiresIn: "30d" });
}

export function setAuthCookie(res: Response, user: AuthUser) {
  res.cookie(COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 86_400_000,
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, "Not logged in");
  try {
    const p = jwt.verify(token, secret()) as AuthUser;
    req.user = { id: p.id, householdId: p.householdId, role: p.role };
  } catch {
    throw new HttpError(401, "Session expired");
  }
  next();
}

/** Only call after requireAuth. */
export const me = (req: Request) => req.user!;
