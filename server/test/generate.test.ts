import { describe, expect, it } from "vitest";
import { generateData } from "../prisma/generate.js";
import { foodId, loadCatalog, loadHousehold, loadRecipes, recipeId, userId } from "../prisma/lib/data.js";

const END = "2026-10-01";
const data = generateData({ seed: 42, endDate: END, days: 120 });

describe("generateData", () => {
  it("is deterministic for the same seed and end date", () => {
    expect(generateData({ seed: 42, endDate: END, days: 120 })).toEqual(data);
  });

  it("produces different data for a different seed", () => {
    expect(generateData({ seed: 7, endDate: END, days: 120 }).inventoryEvents).not.toEqual(data.inventoryEvents);
  });

  it("spans at least 120 days and ends on the end date", () => {
    expect(data.meta.days).toBeGreaterThanOrEqual(120);
    expect(data.meta.endDate).toBe(END);
    const firstEvent = data.inventoryEvents[0].createdAt.slice(0, 10);
    expect(firstEvent).toBe(data.meta.startDate);
  });

  it("never lets stock go negative and batch totals match their events", () => {
    const running = new Map<string, number>();
    const sorted = [...data.inventoryEvents].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const e of sorted) {
      const v = (running.get(e.batchId) ?? 0) + e.quantityDelta;
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      running.set(e.batchId, v);
    }
    for (const b of data.inventoryBatches) {
      expect(running.get(b.id)).toBeCloseTo(b.remainingQuantity, 1);
      if (b.status !== "ACTIVE") expect(b.remainingQuantity).toBe(0);
    }
  });

  it("only references valid foods, users, recipes, batches and meal plan entries", () => {
    const foods = new Set(loadCatalog().map((f) => foodId(f.name)));
    const users = new Set(loadHousehold().members.map((m) => userId(m.key)));
    const recipes = new Set(loadRecipes().map((r) => recipeId(r.name)));
    const batches = new Set(data.inventoryBatches.map((b) => b.id));
    const meals = new Set(data.mealPlan.map((m) => m.id));
    for (const b of data.inventoryBatches) { expect(foods).toContain(b.foodItemId); expect(users).toContain(b.addedById); }
    for (const e of data.inventoryEvents) {
      expect(batches).toContain(e.batchId);
      expect(foods).toContain(e.foodItemId);
      if (e.userId) expect(users).toContain(e.userId);
      if (e.mealPlanEntryId) expect(meals).toContain(e.mealPlanEntryId);
    }
    for (const m of data.mealPlan) expect(recipes).toContain(m.recipeId);
    for (const l of data.eatingLogs) {
      expect(users).toContain(l.userId);
      if (l.recipeId) expect(recipes).toContain(l.recipeId);
      if (l.foodItemId) expect(foods).toContain(l.foodItemId);
    }
  });

  it("never feeds Mia (nut allergy) anything containing nuts", () => {
    const nutFoods = new Set(loadCatalog().filter((f) => f.allergens?.includes("nuts")).map((f) => foodId(f.name)));
    const nutRecipes = new Set(loadRecipes().filter((r) => r.ingredients.some(([n]) => nutFoods.has(foodId(n)))).map((r) => recipeId(r.name)));
    for (const l of data.eatingLogs.filter((x) => x.userId === userId("mia"))) {
      if (l.foodItemId) expect(nutFoods.has(l.foodItemId)).toBe(false);
      if (l.recipeId) expect(nutRecipes.has(l.recipeId)).toBe(false);
    }
  });

  it("leaves a realistic current state: stocked fridge, upcoming plan, some waste", () => {
    expect(data.inventoryBatches.filter((b) => b.status === "ACTIVE").length).toBeGreaterThan(30);
    expect(data.meta.stats.upcomingMeals).toBeGreaterThanOrEqual(7);
    const discarded = data.inventoryEvents.filter((e) => e.type === "DISCARDED").length;
    expect(discarded).toBeGreaterThan(0);
    expect(data.shoppingList.length).toBeGreaterThan(0);
  });
});
