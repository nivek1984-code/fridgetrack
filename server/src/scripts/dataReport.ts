// Prints a sanity-check summary of what's in the database.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const fmt = (n: number, d = 0) => n.toLocaleString("en-GB", { maximumFractionDigits: d });

async function main() {
  const counts = {
    users: await prisma.user.count(),
    foodItems: await prisma.foodItem.count(),
    recipes: await prisma.recipe.count(),
    inventoryBatches: await prisma.inventoryBatch.count(),
    inventoryEvents: await prisma.inventoryEvent.count(),
    mealPlanEntries: await prisma.mealPlanEntry.count(),
    eatingLogs: await prisma.eatingLog.count(),
    favourites: await prisma.favourite.count(),
    shoppingListItems: await prisma.shoppingListItem.count(),
  };
  console.log("\n== Row counts ==");
  console.table(counts);

  const [first, last] = await Promise.all([
    prisma.inventoryEvent.findFirst({ orderBy: { createdAt: "asc" } }),
    prisma.inventoryEvent.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);
  const now = last?.createdAt ?? new Date();
  console.log(`History: ${first?.createdAt.toISOString().slice(0, 10)} -> ${now.toISOString().slice(0, 10)}`);

  console.log("\n== Current fridge (active batches) ==");
  const active = await prisma.inventoryBatch.findMany({ where: { status: "ACTIVE" }, include: { foodItem: true }, orderBy: { expiresAt: "asc" } });
  const byFood = new Map<string, { qty: number; unit: string; nextExpiry: Date | null; location: string }>();
  for (const b of active) {
    const e = byFood.get(b.foodItem.name) ?? { qty: 0, unit: b.unit, nextExpiry: b.expiresAt, location: b.location };
    e.qty += b.remainingQuantity;
    byFood.set(b.foodItem.name, e);
  }
  console.table([...byFood].map(([name, e]) => ({
    item: name, qty: `${fmt(e.qty, 1)} ${e.unit}`, location: e.location,
    expiresInDays: e.nextExpiry ? Math.round((e.nextExpiry.getTime() - now.getTime()) / 86_400_000) : "",
  })));

  console.log("\n== Per-member daily averages (last 30 days) ==");
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const users = await prisma.user.findMany({ include: { eatingLogs: { where: { date: { gte: since } } } } });
  console.table(users.map((u) => {
    const kcal = u.eatingLogs.reduce((s, l) => s + (l.kcal ?? 0), 0) / 30;
    const sugar = u.eatingLogs.reduce((s, l) => s + (l.sugarG ?? 0), 0) / 30;
    const eatOut = u.eatingLogs.filter((l) => l.freeText && !l.recipeId && !l.foodItemId).length;
    return { member: u.name, kcalPerDay: Math.round(kcal), sugarGPerDay: Math.round(sugar), mealsEatenOut: eatOut, logs: u.eatingLogs.length };
  }));

  console.log("\n== Waste ==");
  const batches = await prisma.inventoryBatch.findMany({ select: { foodItemId: true, quantity: true, pricePaid: true } });
  const discarded = await prisma.inventoryEvent.groupBy({ by: ["foodItemId"], where: { type: "DISCARDED" }, _sum: { quantityDelta: true } });
  const bought = new Map<string, { qty: number; spent: number }>();
  for (const b of batches) {
    const e = bought.get(b.foodItemId) ?? { qty: 0, spent: 0 };
    e.qty += b.quantity; e.spent += b.pricePaid ?? 0;
    bought.set(b.foodItemId, e);
  }
  const spend = [...bought.values()].reduce((s, b) => s + b.spent, 0);
  const wasteValue = discarded.reduce((s, d) => {
    const b = bought.get(d.foodItemId)!;
    return s + (b.spent * -(d._sum.quantityDelta ?? 0)) / b.qty;
  }, 0);
  console.log(`Total grocery spend: $${fmt(spend, 2)} | wasted: $${fmt(wasteValue, 2)} (${fmt((100 * wasteValue) / spend, 1)}%)`);

  console.log("\n== Top consumed items ==");
  const consumed = await prisma.inventoryEvent.groupBy({
    by: ["foodItemId"], where: { type: "CONSUMED" }, _sum: { quantityDelta: true },
    orderBy: { _sum: { quantityDelta: "asc" } }, take: 10,
  });
  const names = new Map((await prisma.foodItem.findMany()).map((f) => [f.id, f]));
  console.table(consumed.map((c) => ({ item: names.get(c.foodItemId)!.name, consumed: `${fmt(-(c._sum.quantityDelta ?? 0))} ${names.get(c.foodItemId)!.defaultUnit}` })));

  console.log("\n== Upcoming meal plan ==");
  const upcoming = await prisma.mealPlanEntry.findMany({ where: { cookedAt: null, date: { gte: new Date(now.toISOString().slice(0, 10)) } }, include: { recipe: true }, orderBy: [{ date: "asc" }, { mealType: "asc" }] });
  console.table(upcoming.map((m) => ({ date: m.date.toISOString().slice(0, 10), meal: m.mealType, recipe: m.recipe.name })));

  console.log("\n== Open shopping list ==");
  console.table((await prisma.shoppingListItem.findMany({ where: { checked: false } })).map((s) => ({ item: s.name, qty: `${s.quantity} ${s.unit}`, reason: s.reason })));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
