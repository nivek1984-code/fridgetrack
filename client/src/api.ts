// Thin fetch wrapper + response types for the FridgeTrack API.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export type Unit = "g" | "ml" | "pcs";
export type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
export type LogType = MealType | "DRINK";

export interface User { id: string; name: string; email: string; role: "ADMIN" | "MEMBER"; householdId: string }

export interface Member {
  id: string; name: string; email: string; role: "ADMIN" | "MEMBER";
  birthYear: number | null; sex: string | null; heightCm: number | null; weightKg: number | null;
  activityLevel: string | null; dietaryGoals: string | null; allergies: string | null; dietType: string;
}

export interface Household { id: string; name: string; inviteCode: string; groceryDayPreference: number; runThresholdDays: number; users: Member[] }

export interface FoodItem {
  id: string; name: string; category: string; defaultUnit: Unit; unitSize: number; typicalShelfLifeDays: number;
  location: string; isDrink: boolean; isStaple: boolean; pricePerPack: number | null;
  kcal: number | null; proteinG: number | null; sugarG: number | null; satFatG: number | null; fibreG: number | null; sodiumMg: number | null;
  allergens: string | null;
}
export interface CatalogItem extends FoodItem { stock: number; nextExpiry: string | null; favouriteId: string | null }

export interface Batch {
  id: string; foodItemId: string; quantity: number; remainingQuantity: number; unit: Unit;
  purchasedAt: string; expiresAt: string | null; location: string; status: string; pricePaid: number | null;
}
export interface InventoryBatch extends Batch { foodItem: FoodItem; addedBy: { name: string } | null; daysToExpiry: number | null }

export interface ItemDetail {
  item: FoodItem;
  batches: Batch[];
  series: { date: string; stock: number; consumed: number; added: number; discarded: number }[];
  stats: { days: number; consumedPerDay: number; bought: number; consumed: number; wasted: number; wastePct: number; purchases: number; byMember: { name: string; qty: number }[] };
  events: { id: string; type: string; quantityDelta: number; source: string | null; note: string | null; createdAt: string; user: string | null }[];
}

export interface Forecast {
  foodItemId: string; name: string; category: string; unit: Unit; unitSize: number; isStaple: boolean; isFavourite: boolean;
  currentStock: number; dailyRate: number; habitualRate: number; plannedNext7: number; expiringSoon: number; expiredStock: number;
  runOutDate: string | null; daysLeft: number | null; confidence: number; source: "HISTORY" | "MEAL_PLAN" | "BLEND";
}
export interface GroceryTrip { date: string; reason: string; urgent: boolean; items: { foodItemId: string; name: string; packs: number; quantity: number; unit: Unit; runOutDate: string | null; why: string }[] }
export interface Predictions { forecasts: Forecast[]; proposal: GroceryTrip & { topUp: GroceryTrip | null } }

export interface Recipe {
  id: string; name: string; mealType: MealType; servings: number; prepMinutes: number | null; instructions: string | null; tags: string | null;
  ingredients: { id: string; foodItemId: string; quantity: number; unit: Unit; foodItem: FoodItem }[];
  canMake: boolean; missing: { name: string; need: number; have: number; unit: Unit }[];
  perServing: { kcal: number; sugarG: number; proteinG: number };
  favouritedBy: string[]; allergens: string[];
}

export interface MealPlanEntry { id: string; date: string; mealType: MealType; recipeId: string; servings: number; cookedAt: string | null; recipe: { id: string; name: string; mealType: MealType; servings: number; tags: string | null } }

export interface EatingLog {
  id: string; userId: string; date: string; mealType: LogType; recipeId: string | null; foodItemId: string | null;
  quantity: number | null; freeText: string | null; portionSize: string; kcal: number | null; sugarG: number | null;
  recipe: { name: string } | null; foodItem: { name: string; defaultUnit: Unit } | null;
}

export interface Favourite { id: string; userId: string; user: { id: string; name: string }; foodItem: { id: string; name: string; category: string } | null; recipe: { id: string; name: string } | null }

export interface ShoppingItem {
  id: string; foodItemId: string | null; name: string; quantity: number; unit: string; reason: "RUN_OUT" | "EXPIRING" | "MANUAL";
  checked: boolean; createdAt: string; addedBy: { name: string } | null; foodItem: { id: string; name: string; category: string; unitSize: number } | null;
}

export interface Flag { level: "good" | "warn" | "bad"; area: string; message: string }
export interface AiReport {
  score: number; summary: string; strengths: string[];
  concerns: { issue: string; why: string; severity: "low" | "medium" | "high" }[];
  swaps: { instead: string; try: string; why: string }[];
  shoppingSuggestions: { name: string; reason: string }[];
  encouragement: string;
}
export interface HealthDetail {
  member: { id: string; name: string; age: number };
  rollup: {
    days: number; daysLogged: number;
    perDay: { kcal: number; proteinG: number; sugarG: number; satFatG: number; fibreG: number; sodiumMg: number; fruitVegG: number; sugaryDrinksMl: number; waterMl: number };
    alcoholUnitsPerWeek: number; lateNightSnacksPerWeek: number; mealsEatenOutPerWeek: number; breakfastsSkippedPerWeek: number;
    topFoods: { name: string; times: number }[]; topSugarSources: { name: string; sugarG: number }[];
  };
  targets: { kcal: number; sugarG: number; satFatG: number; fibreG: number; sodiumMg: number; fruitVegG: number; proteinG: number };
  flags: Flag[];
  ruleScore: number;
  aiEnabled: boolean;
  report: { id: string; score: number; summary: string; model: string; createdAt: string; recommendations: AiReport } | null;
}
export interface HealthOverview {
  id: string; name: string; age: number; ruleScore: number; aiScore: number | null; aiReportAt: string | null;
  kcal: number; kcalTarget: number; sugarG: number; sugarTarget: number; fruitVegPortions: number; topConcern: Flag | null;
}
export interface WasteInsights { monthly: { month: string; spent: number; wasted: number }[]; topWasted: { name: string; value: number }[] }
