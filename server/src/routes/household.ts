import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, parse } from "../http.js";
import { me } from "../middleware/auth.js";

export const householdRouter = Router();

householdRouter.get("/household", async (req, res) => {
  const { householdId } = me(req);
  const h = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    include: {
      users: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, role: true, birthYear: true, sex: true, heightCm: true, weightKg: true, activityLevel: true, dietaryGoals: true, allergies: true, dietType: true },
      },
    },
  });
  res.json(h);
});

const HouseholdPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  groceryDayPreference: z.number().int().min(0).max(6).optional(),
  runThresholdDays: z.number().int().min(0).max(7).optional(),
});

householdRouter.patch("/household", async (req, res) => {
  const u = me(req);
  if (u.role !== "ADMIN") throw new HttpError(403, "Only household admins can change household settings");
  const data = parse(HouseholdPatch, req.body);
  res.json(await prisma.household.update({ where: { id: u.householdId }, data }));
});

const ProfilePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  sex: z.enum(["F", "M", "X"]).nullable().optional(),
  heightCm: z.number().int().min(40).max(250).nullable().optional(),
  weightKg: z.number().min(5).max(400).nullable().optional(),
  activityLevel: z.enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"]).nullable().optional(),
  dietaryGoals: z.string().max(300).nullable().optional(),
  allergies: z.string().max(200).nullable().optional(),
  dietType: z.enum(["OMNIVORE", "VEGETARIAN", "VEGAN", "PESCATARIAN"]).optional(),
});

/** Members edit their own profile; admins can edit anyone in the household (e.g. a child's). */
householdRouter.patch("/users/:id", async (req, res) => {
  const u = me(req);
  const target = await prisma.user.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!target) throw new HttpError(404, "Member not found");
  if (target.id !== u.id && u.role !== "ADMIN") throw new HttpError(403, "You can only edit your own profile");
  const data = parse(ProfilePatch, req.body);
  const updated = await prisma.user.update({ where: { id: target.id }, data });
  const { passwordHash: _ph, ...rest } = updated;
  res.json(rest);
});
