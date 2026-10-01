// Predictions, grocery-run proposals, shopping list and health reports.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, notFound, parse } from "../http.js";
import { me } from "../middleware/auth.js";
import { aiEnabled, generateReport, healthContext } from "../services/healthAdvisor.js";
import { addBatch } from "../services/inventory.js";
import { forecastHousehold } from "../services/prediction.js";

export const planningRouter = Router();

planningRouter.get("/predictions", async (req, res) => {
  res.json(await forecastHousehold(me(req).householdId));
});

// ---------- shopping list ----------
const listInclude = { addedBy: { select: { name: true } }, foodItem: { select: { id: true, name: true, category: true, unitSize: true } } } as const;

planningRouter.get("/shopping", async (req, res) => {
  res.json(await prisma.shoppingListItem.findMany({ where: { householdId: me(req).householdId }, include: listInclude, orderBy: [{ checked: "asc" }, { createdAt: "asc" }] }));
});

const NewShop = z.object({
  foodItemId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().positive().default(1),
  unit: z.string().max(10).optional(),
  reason: z.enum(["RUN_OUT", "EXPIRING", "MANUAL"]).default("MANUAL"),
});

planningRouter.post("/shopping", async (req, res) => {
  const u = me(req);
  const body = parse(NewShop, req.body);
  let name = body.name, unit = body.unit ?? "pcs";
  if (body.foodItemId) {
    const f = await prisma.foodItem.findFirst({ where: { id: body.foodItemId, householdId: u.householdId } });
    if (!f) throw notFound("Food item not found");
    name ??= f.name; unit = f.defaultUnit;
  }
  if (!name) throw new HttpError(400, "Give the item a name");
  res.status(201).json(await prisma.shoppingListItem.create({
    data: { householdId: u.householdId, foodItemId: body.foodItemId ?? null, name, quantity: body.quantity, unit, reason: body.reason, addedById: u.id },
    include: listInclude,
  }));
});

/** Add every item from the proposed main shop (or the top-up) that isn't already on the list. */
planningRouter.post("/shopping/from-proposal", async (req, res) => {
  const u = me(req);
  const { trip } = parse(z.object({ trip: z.enum(["main", "topUp"]).default("main") }), req.body ?? {});
  const { proposal } = await forecastHousehold(u.householdId);
  const items = trip === "topUp" ? (proposal.topUp?.items ?? []) : proposal.items;
  const existing = await prisma.shoppingListItem.findMany({ where: { householdId: u.householdId, checked: false } });
  const have = new Set(existing.map((e) => e.foodItemId).filter(Boolean));
  const toAdd = items.filter((i) => !have.has(i.foodItemId));
  await prisma.shoppingListItem.createMany({
    data: toAdd.map((i) => ({ householdId: u.householdId, foodItemId: i.foodItemId, name: i.name, quantity: i.quantity, unit: i.unit, reason: "RUN_OUT", addedById: u.id })),
  });
  res.json({ added: toAdd.length });
});

planningRouter.patch("/shopping/:id", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ checked: z.boolean().optional(), quantity: z.number().positive().optional() }), req.body);
  const item = await prisma.shoppingListItem.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!item) throw notFound("Item not found");
  res.json(await prisma.shoppingListItem.update({ where: { id: item.id }, data: body, include: listInclude }));
});

planningRouter.delete("/shopping/:id", async (req, res) => {
  const u = me(req);
  const item = await prisma.shoppingListItem.findFirst({ where: { id: req.params.id, householdId: u.householdId } });
  if (!item) throw notFound("Item not found");
  await prisma.shoppingListItem.delete({ where: { id: item.id } });
  res.status(204).end();
});

/** "Done shopping": ticked catalog items go into the fridge as new batches and leave the list. */
planningRouter.post("/shopping/checkout", async (req, res) => {
  const u = me(req);
  const result = await prisma.$transaction(async (tx) => {
    const items = await tx.shoppingListItem.findMany({ where: { householdId: u.householdId, checked: true }, include: { foodItem: true } });
    let stocked = 0;
    for (const i of items) {
      if (i.foodItem) {
        await addBatch(tx, { food: i.foodItem, quantity: i.quantity, userId: u.id, pricePaid: i.foodItem.pricePerPack ? Math.round((i.quantity / i.foodItem.unitSize) * i.foodItem.pricePerPack * 100) / 100 : null });
        stocked++;
      }
    }
    await tx.shoppingListItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    return { stocked, cleared: items.length };
  });
  res.json(result);
});

// ---------- health ----------
async function memberFor(req: Parameters<typeof me>[0]) {
  const u = me(req);
  const target = await prisma.user.findFirst({ where: { id: String(req.params.userId), householdId: u.householdId } });
  if (!target) throw notFound("Member not found");
  if (target.id !== u.id && u.role !== "ADMIN") throw new HttpError(403, "Only household admins can see other members' health reports");
  return target;
}

planningRouter.get("/health/:userId", async (req, res) => {
  const target = await memberFor(req);
  const days = Math.min(60, Math.max(7, Number(req.query.days) || 14));
  const ctx = await healthContext(target.id, days);
  const latest = await prisma.healthReport.findFirst({ where: { userId: target.id }, orderBy: { createdAt: "desc" } });
  res.json({
    member: { id: target.id, name: target.name, age: ctx.age },
    rollup: ctx.rollup,
    targets: ctx.targets,
    flags: ctx.flags,
    ruleScore: ctx.ruleScore,
    aiEnabled: aiEnabled(),
    report: latest ? { ...latest, recommendations: JSON.parse(latest.recommendations) } : null,
  });
});

planningRouter.post("/health/:userId/report", async (req, res) => {
  const target = await memberFor(req);
  const days = Math.min(60, Math.max(7, Number(req.body?.days) || 14));
  const report = await generateReport(target.id, days);
  res.status(201).json({ ...report, recommendations: JSON.parse(report.recommendations) });
});

/** Family overview: rule-based score per member (admins see everyone, members see themselves). */
planningRouter.get("/health", async (req, res) => {
  const u = me(req);
  const users = await prisma.user.findMany({ where: { householdId: u.householdId, ...(u.role === "ADMIN" ? {} : { id: u.id }) }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const m of users) {
    const ctx = await healthContext(m.id, 14);
    const latest = await prisma.healthReport.findFirst({ where: { userId: m.id }, orderBy: { createdAt: "desc" }, select: { score: true, createdAt: true } });
    out.push({
      id: m.id, name: m.name, age: ctx.age, ruleScore: ctx.ruleScore, aiScore: latest?.score ?? null, aiReportAt: latest?.createdAt ?? null,
      kcal: ctx.rollup.perDay.kcal, kcalTarget: ctx.targets.kcal, sugarG: ctx.rollup.perDay.sugarG, sugarTarget: ctx.targets.sugarG,
      fruitVegPortions: Math.round(ctx.rollup.perDay.fruitVegG / 80 * 10) / 10,
      topConcern: ctx.flags.find((f) => f.level === "bad") ?? ctx.flags.find((f) => f.level === "warn") ?? null,
    });
  }
  res.json(out);
});
