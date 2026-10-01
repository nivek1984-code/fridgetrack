// Recipes, meal plan, eating logs and favourites.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, addDays, notFound, parse, r1, startOfDay } from "../http.js";
import { me } from "../middleware/auth.js";
import { consumeFIFO, nutritionFor, stockByFood } from "../services/inventory.js";

export const mealsRouter = Router();

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
const LOG_TYPES = [...MEAL_TYPES, "DRINK"] as const;

// ---------- recipes ----------
mealsRouter.get("/recipes", async (req, res) => {
  const u = me(req);
  const [recipes, stock, favs] = await Promise.all([
    prisma.recipe.findMany({ where: { householdId: u.householdId }, include: { ingredients: { include: { foodItem: true } } }, orderBy: { name: "asc" } }),
    stockByFood(u.householdId),
    prisma.favourite.findMany({ where: { user: { householdId: u.householdId }, recipeId: { not: null } }, include: { user: { select: { name: true } } } }),
  ]);
  res.json(recipes.map((r) => {
    const missing = r.ingredients
      .filter((i) => (stock.get(i.foodItemId)?.qty ?? 0) < i.quantity)
      .map((i) => ({ name: i.foodItem.name, need: i.quantity, have: r1(stock.get(i.foodItemId)?.qty ?? 0), unit: i.unit }));
    const perServing = r.ingredients.reduce((s, i) => {
      const n = nutritionFor(i.foodItem, i.quantity / r.servings);
      return { kcal: s.kcal + n.kcal, sugarG: s.sugarG + n.sugarG, proteinG: s.proteinG + n.proteinG };
    }, { kcal: 0, sugarG: 0, proteinG: 0 });
    return {
      ...r,
      canMake: missing.length === 0,
      missing,
      perServing: { kcal: Math.round(perServing.kcal), sugarG: r1(perServing.sugarG), proteinG: r1(perServing.proteinG) },
      favouritedBy: favs.filter((f) => f.recipeId === r.id).map((f) => f.user.name),
      allergens: [...new Set(r.ingredients.flatMap((i) => i.foodItem.allergens?.split(",") ?? []))],
    };
  }));
});

const NewRecipe = z.object({
  name: z.string().trim().min(1).max(100),
  mealType: z.enum(MEAL_TYPES),
  servings: z.number().int().min(1).max(20),
  prepMinutes: z.number().int().min(0).max(1000).nullable().optional(),
  instructions: z.string().max(5000).nullable().optional(),
  tags: z.string().max(200).nullable().optional(),
  ingredients: z.array(z.object({ foodItemId: z.string(), quantity: z.number().positive() })).min(1),
});

mealsRouter.post("/recipes", async (req, res) => {
  const u = me(req);
  const body = parse(NewRecipe, req.body);
  const foods = await prisma.foodItem.findMany({ where: { householdId: u.householdId, id: { in: body.ingredients.map((i) => i.foodItemId) } } });
  const unit = new Map(foods.map((f) => [f.id, f.defaultUnit]));
  if (foods.length !== new Set(body.ingredients.map((i) => i.foodItemId)).size) throw new HttpError(400, "Unknown ingredient");
  if (await prisma.recipe.findFirst({ where: { householdId: u.householdId, name: body.name } })) throw new HttpError(409, "A recipe with that name already exists");
  const recipe = await prisma.recipe.create({
    data: {
      householdId: u.householdId, createdById: u.id, name: body.name, mealType: body.mealType, servings: body.servings,
      prepMinutes: body.prepMinutes ?? null, instructions: body.instructions ?? null, tags: body.tags ?? null,
      ingredients: { create: body.ingredients.map((i) => ({ foodItemId: i.foodItemId, quantity: i.quantity, unit: unit.get(i.foodItemId)! })) },
    },
    include: { ingredients: true },
  });
  res.status(201).json(recipe);
});

mealsRouter.delete("/recipes/:id", async (req, res) => {
  const u = me(req);
  const r = await prisma.recipe.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!r) throw notFound("Recipe not found");
  await prisma.recipe.delete({ where: { id: r.id } });
  res.status(204).end();
});

// ---------- meal plan ----------
mealsRouter.get("/mealplan", async (req, res) => {
  const u = me(req);
  const from = req.query.from ? startOfDay(new Date(String(req.query.from))) : startOfDay(new Date());
  const to = req.query.to ? startOfDay(new Date(String(req.query.to))) : addDays(from, 7);
  res.json(await prisma.mealPlanEntry.findMany({
    where: { householdId: u.householdId, date: { gte: from, lt: addDays(to, 1) } },
    include: { recipe: { select: { id: true, name: true, mealType: true, servings: true, tags: true } } },
    orderBy: [{ date: "asc" }, { mealType: "asc" }],
  }));
});

const NewPlan = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(MEAL_TYPES),
  recipeId: z.string(),
  servings: z.number().int().min(1).max(20),
});

mealsRouter.post("/mealplan", async (req, res) => {
  const u = me(req);
  const body = parse(NewPlan, req.body);
  const r = await prisma.recipe.findFirst({ where: { id: body.recipeId, householdId: u.householdId } });
  if (!r) throw notFound("Recipe not found");
  const entry = await prisma.mealPlanEntry.create({
    data: { householdId: u.householdId, date: new Date(`${body.date}T00:00:00Z`), mealType: body.mealType, recipeId: r.id, servings: body.servings },
    include: { recipe: { select: { id: true, name: true, mealType: true, servings: true, tags: true } } },
  });
  res.status(201).json(entry);
});

mealsRouter.delete("/mealplan/:id", async (req, res) => {
  const u = me(req);
  const e = await prisma.mealPlanEntry.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!e) throw notFound("Meal not found");
  await prisma.mealPlanEntry.delete({ where: { id: e.id } });
  res.status(204).end();
});

const Cook = z.object({ eaterIds: z.array(z.string()).default([]) });

/** Mark a planned meal as cooked: uses ingredients from the fridge and logs it for each eater. */
mealsRouter.post("/mealplan/:id/cook", async (req, res) => {
  const u = me(req);
  const { eaterIds } = parse(Cook, req.body ?? {});
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.mealPlanEntry.findFirst({ where: { id: req.params.id, householdId: u.householdId }, include: { recipe: { include: { ingredients: { include: { foodItem: true } } } } } });
    if (!entry) throw notFound("Meal not found");
    if (entry.cookedAt) throw new HttpError(400, "Already cooked");
    const eaters = await tx.user.findMany({ where: { householdId: u.householdId, id: { in: eaterIds } } });
    const now = new Date();
    const shortages: string[] = [];
    let kcal = 0, sugar = 0;
    for (const ing of entry.recipe.ingredients) {
      const need = (ing.quantity * entry.servings) / entry.recipe.servings;
      const qty = ing.foodItem.defaultUnit === "pcs" ? Math.round(need) : need;
      if (qty <= 0) continue;
      const taken = await consumeFIFO(tx, { foodItemId: ing.foodItemId, quantity: qty, userId: u.id, source: "MEAL_PLAN", mealPlanEntryId: entry.id, at: now });
      if (taken < qty - 1e-6) shortages.push(ing.foodItem.name);
      const n = nutritionFor(ing.foodItem, ing.quantity / entry.recipe.servings);
      kcal += n.kcal; sugar += n.sugarG;
    }
    const portion = eaters.length ? entry.servings / eaters.length : 1;
    for (const e of eaters) {
      await tx.eatingLog.create({
        data: { userId: e.id, date: now, mealType: entry.mealType, recipeId: entry.recipeId, quantity: r1(portion), portionSize: portion < 0.8 ? "SMALL" : portion > 1.15 ? "LARGE" : "NORMAL", kcal: Math.round(kcal * portion), sugarG: r1(sugar * portion) },
      });
    }
    await tx.mealPlanEntry.update({ where: { id: entry.id }, data: { cookedAt: now } });
    return { cookedAt: now, shortages, logged: eaters.length };
  });
  res.json(result);
});

// ---------- eating logs ----------
async function canSeeMember(viewer: { id: string; householdId: string; role: string }, userId: string) {
  const target = await prisma.user.findFirst({ where: { id: userId, householdId: viewer.householdId } });
  if (!target) throw notFound("Member not found");
  if (target.id !== viewer.id && viewer.role !== "ADMIN") throw new HttpError(403, "You can only view your own log");
  return target;
}

mealsRouter.get("/logs", async (req, res) => {
  const u = me(req);
  const userId = String(req.query.userId ?? u.id);
  await canSeeMember(u, userId);
  const days = Math.min(90, Number(req.query.days) || 7);
  res.json(await prisma.eatingLog.findMany({
    where: { userId, date: { gte: addDays(startOfDay(new Date()), -days + 1) } },
    include: { recipe: { select: { name: true } }, foodItem: { select: { name: true, defaultUnit: true } } },
    orderBy: { date: "desc" },
  }));
});

const NewLog = z.object({
  userId: z.string().optional(),
  date: z.coerce.date().optional(),
  mealType: z.enum(LOG_TYPES),
  recipeId: z.string().nullable().optional(),
  foodItemId: z.string().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  freeText: z.string().trim().max(200).nullable().optional(),
  portionSize: z.enum(["SMALL", "NORMAL", "LARGE"]).default("NORMAL"),
  kcal: z.number().nonnegative().nullable().optional(),
  takeFromFridge: z.boolean().default(false),
}).refine((b) => b.recipeId || b.foodItemId || b.freeText, { message: "Pick a recipe, a food, or describe the meal" });

mealsRouter.post("/logs", async (req, res) => {
  const u = me(req);
  const body = parse(NewLog, req.body);
  const userId = body.userId ?? u.id;
  await canSeeMember(u, userId);
  const log = await prisma.$transaction(async (tx) => {
    let kcal = body.kcal ?? null, sugarG: number | null = null;
    const quantity = body.quantity ?? (body.recipeId ? 1 : null);
    if (body.foodItemId) {
      const f = await tx.foodItem.findFirst({ where: { id: body.foodItemId, householdId: u.householdId } });
      if (!f) throw notFound("Food item not found");
      const q = quantity ?? f.unitSize;
      if (body.takeFromFridge) await consumeFIFO(tx, { foodItemId: f.id, quantity: q, userId, source: "SNACK" });
      const n = nutritionFor(f, q);
      kcal ??= Math.round(n.kcal); sugarG = r1(n.sugarG);
    } else if (body.recipeId) {
      const r = await tx.recipe.findFirst({ where: { id: body.recipeId, householdId: u.householdId }, include: { ingredients: { include: { foodItem: true } } } });
      if (!r) throw notFound("Recipe not found");
      let k = 0, s = 0;
      for (const ing of r.ingredients) {
        const n = nutritionFor(ing.foodItem, (ing.quantity * (quantity ?? 1)) / r.servings);
        k += n.kcal; s += n.sugarG;
        if (body.takeFromFridge) await consumeFIFO(tx, { foodItemId: ing.foodItemId, quantity: (ing.quantity * (quantity ?? 1)) / r.servings, userId, source: "SNACK" });
      }
      kcal ??= Math.round(k); sugarG = r1(s);
    }
    return tx.eatingLog.create({
      data: {
        userId, date: body.date ?? new Date(), mealType: body.mealType, recipeId: body.recipeId ?? null, foodItemId: body.foodItemId ?? null,
        quantity, freeText: body.freeText ?? null, portionSize: body.portionSize, kcal, sugarG,
      },
    });
  });
  res.status(201).json(log);
});

mealsRouter.delete("/logs/:id", async (req, res) => {
  const u = me(req);
  const log = await prisma.eatingLog.findFirst({ where: { id: req.params.id, user: { householdId: u.householdId } } });
  if (!log) throw notFound("Log not found");
  await canSeeMember(u, log.userId);
  await prisma.eatingLog.delete({ where: { id: log.id } });
  res.status(204).end();
});

// ---------- favourites ----------
mealsRouter.get("/favourites", async (req, res) => {
  const u = me(req);
  res.json(await prisma.favourite.findMany({
    where: { user: { householdId: u.householdId } },
    include: { user: { select: { id: true, name: true } }, foodItem: { select: { id: true, name: true, category: true } }, recipe: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  }));
});

const NewFav = z.object({ foodItemId: z.string().optional(), recipeId: z.string().optional(), note: z.string().max(200).optional() })
  .refine((b) => !!b.foodItemId !== !!b.recipeId, { message: "Favourite either a food or a recipe" });

mealsRouter.post("/favourites", async (req, res) => {
  const u = me(req);
  const body = parse(NewFav, req.body);
  if (body.foodItemId && !(await prisma.foodItem.findFirst({ where: { id: body.foodItemId, householdId: u.householdId } }))) throw notFound("Food item not found");
  if (body.recipeId && !(await prisma.recipe.findFirst({ where: { id: body.recipeId, householdId: u.householdId } }))) throw notFound("Recipe not found");
  const existing = await prisma.favourite.findFirst({ where: { userId: u.id, foodItemId: body.foodItemId ?? null, recipeId: body.recipeId ?? null } });
  if (existing) { res.json(existing); return; }
  res.status(201).json(await prisma.favourite.create({ data: { userId: u.id, foodItemId: body.foodItemId ?? null, recipeId: body.recipeId ?? null, note: body.note ?? null } }));
});

mealsRouter.delete("/favourites/:id", async (req, res) => {
  const u = me(req);
  const f = await prisma.favourite.findFirst({ where: { id: req.params.id, userId: u.id } });
  if (!f) throw notFound("Favourite not found");
  await prisma.favourite.delete({ where: { id: f.id } });
  res.status(204).end();
});
