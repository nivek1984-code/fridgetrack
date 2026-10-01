import type { FoodItem, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError, addDays } from "../http.js";

type Tx = Prisma.TransactionClient;
const EPS = 1e-6;

/** Nutrition for `qty` of a food in its default unit (per 100 g/ml, or per piece). */
export function nutritionFor(f: Pick<FoodItem, "defaultUnit" | "kcal" | "proteinG" | "sugarG" | "satFatG" | "fibreG" | "sodiumMg">, qty: number) {
  const k = f.defaultUnit === "pcs" ? qty : qty / 100;
  return {
    kcal: (f.kcal ?? 0) * k,
    proteinG: (f.proteinG ?? 0) * k,
    sugarG: (f.sugarG ?? 0) * k,
    satFatG: (f.satFatG ?? 0) * k,
    fibreG: (f.fibreG ?? 0) * k,
    sodiumMg: (f.sodiumMg ?? 0) * k,
  };
}

export async function assertFoodInHousehold(tx: Tx, foodItemId: string, householdId: string) {
  const f = await tx.foodItem.findFirst({ where: { id: foodItemId, householdId } });
  if (!f) throw new HttpError(404, "Food item not found");
  return f;
}

/** Current stock per food item (sum of active batches). */
export async function stockByFood(householdId: string) {
  const batches = await prisma.inventoryBatch.findMany({
    where: { status: "ACTIVE", foodItem: { householdId } },
    orderBy: { expiresAt: "asc" },
  });
  const map = new Map<string, { qty: number; nextExpiry: Date | null; batches: number }>();
  for (const b of batches) {
    const e = map.get(b.foodItemId) ?? { qty: 0, nextExpiry: b.expiresAt, batches: 0 };
    e.qty += b.remainingQuantity;
    e.batches++;
    map.set(b.foodItemId, e);
  }
  return map;
}

export async function addBatch(
  tx: Tx,
  opts: { food: FoodItem; quantity: number; userId: string; expiresAt?: Date | null; location?: string; pricePaid?: number | null; at?: Date },
) {
  const at = opts.at ?? new Date();
  const batch = await tx.inventoryBatch.create({
    data: {
      foodItemId: opts.food.id,
      quantity: opts.quantity,
      remainingQuantity: opts.quantity,
      unit: opts.food.defaultUnit,
      purchasedAt: at,
      expiresAt: opts.expiresAt === undefined ? addDays(at, opts.food.typicalShelfLifeDays) : opts.expiresAt,
      location: opts.location ?? opts.food.location,
      addedById: opts.userId,
      pricePaid: opts.pricePaid ?? null,
    },
  });
  await tx.inventoryEvent.create({
    data: { batchId: batch.id, foodItemId: opts.food.id, userId: opts.userId, type: "ADDED", quantityDelta: opts.quantity, source: "MANUAL", createdAt: at },
  });
  return batch;
}

/** Take `qty` from the soonest-expiring active batches first. Returns how much was actually available. */
export async function consumeFIFO(
  tx: Tx,
  opts: { foodItemId: string; quantity: number; userId: string | null; source: string; mealPlanEntryId?: string | null; at?: Date },
) {
  const at = opts.at ?? new Date();
  const batches = await tx.inventoryBatch.findMany({
    where: { foodItemId: opts.foodItemId, status: "ACTIVE" },
    orderBy: [{ expiresAt: "asc" }, { purchasedAt: "asc" }],
  });
  let left = opts.quantity;
  let taken = 0;
  for (const b of batches) {
    if (left <= EPS) break;
    const take = Math.min(left, b.remainingQuantity);
    const remaining = Math.max(0, Math.round((b.remainingQuantity - take) * 100) / 100);
    await tx.inventoryBatch.update({ where: { id: b.id }, data: { remainingQuantity: remaining, status: remaining === 0 ? "FINISHED" : "ACTIVE" } });
    await tx.inventoryEvent.create({
      data: { batchId: b.id, foodItemId: opts.foodItemId, userId: opts.userId, type: "CONSUMED", quantityDelta: -take, source: opts.source, mealPlanEntryId: opts.mealPlanEntryId ?? null, createdAt: at },
    });
    left -= take;
    taken += take;
  }
  return taken;
}

export async function discardBatch(tx: Tx, batchId: string, householdId: string, userId: string, note?: string) {
  const b = await tx.inventoryBatch.findFirst({ where: { id: batchId, foodItem: { householdId } } });
  if (!b) throw new HttpError(404, "Batch not found");
  if (b.status !== "ACTIVE") throw new HttpError(400, "Batch is no longer in the fridge");
  await tx.inventoryEvent.create({
    data: { batchId: b.id, foodItemId: b.foodItemId, userId, type: "DISCARDED", quantityDelta: -b.remainingQuantity, source: "MANUAL", note: note ?? null, createdAt: new Date() },
  });
  return tx.inventoryBatch.update({ where: { id: b.id }, data: { remainingQuantity: 0, status: "DISCARDED" } });
}
