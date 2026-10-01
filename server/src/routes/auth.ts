import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, parse } from "../http.js";
import { COOKIE, me, requireAuth, setAuthCookie } from "../middleware/auth.js";

export const authRouter = Router();

const publicUser = (u: { id: string; name: string; email: string; role: string; householdId: string }) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, householdId: u.householdId,
});

const Register = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  householdName: z.string().trim().min(1).max(80).optional(),
  inviteCode: z.string().trim().optional(),
}).refine((b) => b.householdName || b.inviteCode, { message: "Give a household name to create one, or an invite code to join one" });

authRouter.post("/register", async (req, res) => {
  const body = parse(Register, req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, "An account with that email already exists");

  let householdId: string;
  let role: "ADMIN" | "MEMBER" = "MEMBER";
  if (body.inviteCode) {
    const h = await prisma.household.findUnique({ where: { inviteCode: body.inviteCode.toUpperCase() } });
    if (!h) throw new HttpError(404, "Invite code not found");
    householdId = h.id;
  } else {
    const h = await prisma.household.create({
      data: { name: body.householdName!, inviteCode: randomBytes(4).toString("hex").toUpperCase() },
    });
    householdId = h.id;
    role = "ADMIN";
  }
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 10), householdId, role },
  });
  setAuthCookie(res, { id: user.id, householdId, role });
  res.status(201).json(publicUser(user));
});

const Login = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

authRouter.post("/login", async (req, res) => {
  const body = parse(Login, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, "Wrong email or password");
  setAuthCookie(res, { id: user.id, householdId: user.householdId, role: user.role as "ADMIN" | "MEMBER" });
  res.json(publicUser(user));
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: me(req).id } });
  if (!user) throw new HttpError(401, "Account no longer exists");
  res.json(publicUser(user));
});
