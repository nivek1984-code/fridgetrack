import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, addDays, notFound, parse, r1, startOfDay } from "../http.js";
import { me } from "../middleware/auth.js";
import { daysUntilExpiry, expiryStatus } from "../services/expiry.js";
import { addBatch, assertFoodInHousehold, consumeFIFO, discardBatch, nutritionFor, stockByFood } from "../services/inventory.js";

export const inventoryRouter = Router();

const CATEGORIES = ["DAIRY", "PRODUCE", "MEAT", "FISH", "EGGS", "BAKERY", "DRINKS", "CONDIMENTS", "FROZEN", "SNACKS", "PANTRY"] as const;
const LOCATIONS = ["FRIDGE", "FREEZER", "PANTRY"] as const;

/** Food catalog with current stock and whether the current user favourites it. */
inventoryRouter.get("/items", async (req, res) => {
  const u = me(req);
  const [items, stock, favs] = await Promise.all([
    prisma.foodItem.findMany({ where: { householdId: u.householdId }, orderBy: { name: "asc" } }),
    stockByFood(u.householdId),
    prisma.favourite.findMany({ where: { userId: u.id, foodItemId: { not: null } } }),
  ]);
  const favIds = new Map(favs.map((f) => [f.foodItemId!, f.id]));
  res.json(items.map((i) => ({
    ...i,
    stock: r1(stock.get(i.id)?.total ?? 0),
    expiredStock: r1(stock.get(i.id)?.expired ?? 0),
    nextExpiry: stock.get(i.id)?.next?.expiresAt ?? null,
    favouriteId: favIds.get(i.id) ?? null,
  })));
});

const NewItem = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  defaultUnit: z.enum(["g", "ml", "pcs"]),
  unitSize: z.number().positive(),
  typicalShelfLifeDays: z.number().int().positive(),
  location: z.enum(LOCATIONS).default("FRIDGE"),
  isDrink: z.boolean().default(false),
  isStaple: z.boolean().default(false),
  pricePerPack: z.number().nonnegative().nullable().optional(),
  kcal: z.number().nonnegative().nullable().optional(),
  proteinG: z.number().nonnegative().nullable().optional(),
  sugarG: z.number().nonnegative().nullable().optional(),
  satFatG: z.number().nonnegative().nullable().optional(),
  fibreG: z.number().nonnegative().nullable().optional(),
  sodiumMg: z.number().nonnegative().nullable().optional(),
  allergens: z.string().max(100).nullable().optional(),
});

inventoryRouter.post("/items", async (req, res) => {
  const u = me(req);
  const data = parse(NewItem, req.body);
  if (await prisma.foodItem.findFirst({ where: { householdId: u.householdId, name: data.name } })) throw new HttpError(409, "That item already exists");
  res.status(201).json(await prisma.foodItem.create({ data: { ...data, householdId: u.householdId } }));
});

/** Item detail: active batches, recent events, daily stock series and stats. */
inventoryRouter.get("/items/:id", async (req, res) => {
  const u = me(req);
  const days = Math.min(180, Number(req.query.days) || 60);
  const item = await prisma.foodItem.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!item) throw notFound("Item not found");
  const [batches, allEvents] = await Promise.all([
    prisma.inventoryBatch.findMany({ where: { foodItemId: item.id, status: "ACTIVE" }, orderBy: { expiresAt: "asc" } }),
    prisma.inventoryEvent.findMany({ where: { foodItemId: item.id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
  ]);
  const today = startOfDay(new Date());
  const from = addDays(today, -days + 1);
  // Walk all events to get stock at each day end.
  const series: { date: string; stock: number; consumed: number; added: number; discarded: number }[] = [];
  let level = 0, idx = 0;
  for (const e of allEvents) { if (e.createdAt >= from) break; level += e.quantityDelta; idx++; }
  for (let d = 0; d < days; d++) {
    const end = addDays(from, d + 1);
    const row = { date: addDays(from, d).toISOString().slice(0, 10), stock: 0, consumed: 0, added: 0, discarded: 0 };
    while (idx < allEvents.length && allEvents[idx].createdAt < end) {
      const e = allEvents[idx++];
      level += e.quantityDelta;
      if (e.type === "CONSUMED") row.consumed += -e.quantityDelta;
      else if (e.type === "ADDED") row.added += e.quantityDelta;
      else if (e.type === "DISCARDED") row.discarded += -e.quantityDelta;
    }
    row.stock = r1(Math.max(0, level));
    row.consumed = r1(row.consumed); row.added = r1(row.added); row.discarded = r1(row.discarded);
    series.push(row);
  }
  const win = allEvents.filter((e) => e.createdAt >= from);
  const sum = (t: string) => win.filter((e) => e.type === t).reduce((s, e) => s + Math.abs(e.quantityDelta), 0);
  const bought = sum("ADDED"), wasted = sum("DISCARDED"), consumed = sum("CONSUMED");
  const byUser = new Map<string, number>();
  for (const e of win) if (e.type === "CONSUMED" && e.user) byUser.set(e.user.name, (byUser.get(e.user.name) ?? 0) + -e.quantityDelta);
  res.json({
    item,
    batches,
    series,
    stats: {
      days,
      consumedPerDay: r1(consumed / days),
      bought: r1(bought), consumed: r1(consumed), wasted: r1(wasted),
      wastePct: bought ? Math.round((wasted / bought) * 100) : 0,
      purchases: win.filter((e) => e.type === "ADDED").length,
      byMember: [...byUser].map(([name, qty]) => ({ name, qty: r1(qty) })).sort((a, b) => b.qty - a.qty),
    },
    events: win.slice(-50).reverse().map((e) => ({ id: e.id, type: e.type, quantityDelta: r1(e.quantityDelta), source: e.source, note: e.note, createdAt: e.createdAt, user: e.user?.name ?? null })),
  });
});

/** What's physically in the fridge/freezer/pantry right now. */
inventoryRouter.get("/inventory", async (req, res) => {
  const u = me(req);
  const batches = await prisma.inventoryBatch.findMany({
    where: { status: "ACTIVE", foodItem: { householdId: u.householdId } },
    include: { foodItem: true, addedBy: { select: { name: true } } },
    orderBy: [{ expiresAt: "asc" }],
  });
  const now = new Date();
  res.json(batches.map((b) => {
    const daysToExpiry = daysUntilExpiry(b.expiresAt, now);
    return { ...b, daysToExpiry, expiryStatus: expiryStatus(daysToExpiry) };
  }));
});

const AddStock = z.object({
  foodItemId: z.string(),
  quantity: z.number().positive(),
  expiresAt: z.coerce.date().nullable().optional(),
  location: z.enum(LOCATIONS).optional(),
  pricePaid: z.number().nonnegative().nullable().optional(),
});

inventoryRouter.post("/inventory", async (req, res) => {
  const u = me(req);
  const body = parse(AddStock, req.body);
  const batch = await prisma.$transaction(async (tx) => {
    const food = await assertFoodInHousehold(tx, body.foodItemId, u.householdId);
    return addBatch(tx, { food, quantity: body.quantity, userId: u.id, expiresAt: body.expiresAt, location: body.location, pricePaid: body.pricePaid });
  });
  res.status(201).json(batch);
});

const Consume = z.object({
  foodItemId: z.string(),
  quantity: z.number().positive(),
  logAsEaten: z.boolean().default(true),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "DRINK"]).optional(),
});

/** "I ate/drank this": takes from the fridge (FIFO) and optionally logs it to the eater's habits. */
inventoryRouter.post("/inventory/consume", async (req, res) => {
  const u = me(req);
  const body = parse(Consume, req.body);
  const result = await prisma.$transaction(async (tx) => {
    const food = await assertFoodInHousehold(tx, body.foodItemId, u.householdId);
    const taken = await consumeFIFO(tx, { foodItemId: food.id, quantity: body.quantity, userId: u.id, source: "SNACK" });
    if (taken <= 0) throw new HttpError(400, `There's no ${food.name} left`);
    if (body.logAsEaten) {
      const n = nutritionFor(food, taken);
      await tx.eatingLog.create({
        data: { userId: u.id, date: new Date(), mealType: body.mealType ?? (food.isDrink ? "DRINK" : "SNACK"), foodItemId: food.id, quantity: taken, portionSize: "NORMAL", kcal: Math.round(n.kcal), sugarG: r1(n.sugarG) },
      });
    }
    return { taken: r1(taken), requested: body.quantity };
  });
  res.json(result);
});

inventoryRouter.post("/inventory/batches/:id/discard", async (req, res) => {
  const u = me(req);
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : undefined;
  res.json(await prisma.$transaction((tx) => discardBatch(tx, req.params.id, u.householdId, u.id, note)));
});

/** Waste and spend summary per month. */
inventoryRouter.get("/insights/waste", async (req, res) => {
  const u = me(req);
  const [batches, discards] = await Promise.all([
    prisma.inventoryBatch.findMany({ where: { foodItem: { householdId: u.householdId } }, select: { id: true, foodItemId: true, quantity: true, pricePaid: true, purchasedAt: true, foodItem: { select: { name: true } } } }),
    prisma.inventoryEvent.findMany({ where: { type: "DISCARDED", foodItem: { householdId: u.householdId } }, select: { batchId: true, quantityDelta: true, createdAt: true } }),
  ]);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const months = new Map<string, { month: string; spent: number; wasted: number }>();
  const m = (d: Date) => d.toISOString().slice(0, 7);
  for (const b of batches) {
    const row = months.get(m(b.purchasedAt)) ?? { month: m(b.purchasedAt), spent: 0, wasted: 0 };
    row.spent += b.pricePaid ?? 0;
    months.set(row.month, row);
  }
  const wastedByItem = new Map<string, number>();
  for (const d of discards) {
    const b = batchById.get(d.batchId);
    if (!b || !b.quantity) continue;
    const value = ((b.pricePaid ?? 0) * -d.quantityDelta) / b.quantity;
    const row = months.get(m(d.createdAt)) ?? { month: m(d.createdAt), spent: 0, wasted: 0 };
    row.wasted += value;
    months.set(row.month, row);
    wastedByItem.set(b.foodItem.name, (wastedByItem.get(b.foodItem.name) ?? 0) + value);
  }
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ ...r, spent: Math.round(r.spent * 100) / 100, wasted: Math.round(r.wasted * 100) / 100 }));
  res.json({
    monthly,
    topWasted: [...wastedByItem].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })),
  });
});
