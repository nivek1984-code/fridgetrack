// Run-out forecasting and grocery-run proposals.
//
// For each food item we simulate the next HORIZON days:
//   stock(d+1) = stock(d) - habitualRate - plannedMeals(d) - expiringBatches(d)
// habitualRate comes from consumption history that did NOT come from planned
// meals (snacks, drinks, breakfasts...), so planned demand isn't double counted.
import type { FoodItem } from "@prisma/client";
import { prisma } from "../db.js";
import { DAY_MS, addDays, r1, startOfDay } from "../http.js";

export const HORIZON = 14;
const HISTORY_DAYS = 28;

export interface ItemForecast {
  foodItemId: string;
  name: string;
  category: string;
  unit: string;
  unitSize: number;
  isStaple: boolean;
  isFavourite: boolean;
  currentStock: number;
  dailyRate: number; // habitual + average planned, per day
  habitualRate: number;
  plannedNext7: number;
  expiringSoon: number; // quantity expiring within 3 days
  expiredStock: number; // still in the fridge but past its date (not counted as usable)
  runOutDate: string | null; // ISO date, null if it lasts beyond the horizon
  daysLeft: number | null;
  confidence: number;
  source: "HISTORY" | "MEAL_PLAN" | "BLEND";
}

export interface GroceryTrip {
  date: string;
  reason: string;
  urgent: boolean;
  items: { foodItemId: string; name: string; packs: number; quantity: number; unit: string; runOutDate: string | null; why: string }[];
}
/** The usual weekly shop, plus an optional top-up when important items won't last until then. */
export interface GroceryProposal extends GroceryTrip {
  topUp: GroceryTrip | null;
}

export async function forecastHousehold(householdId: string, now = new Date()) {
  const today = startOfDay(now);
  const since = addDays(today, -HISTORY_DAYS);

  const [foods, batches, events, plan, household, favourites] = await Promise.all([
    prisma.foodItem.findMany({ where: { householdId } }),
    prisma.inventoryBatch.findMany({ where: { status: "ACTIVE", foodItem: { householdId } } }),
    prisma.inventoryEvent.findMany({
      where: { type: "CONSUMED", createdAt: { gte: since, lte: now }, foodItem: { householdId } },
      select: { foodItemId: true, quantityDelta: true, createdAt: true, source: true },
    }),
    prisma.mealPlanEntry.findMany({
      where: { householdId, cookedAt: null, date: { gte: today, lt: addDays(today, HORIZON) } },
      include: { recipe: { include: { ingredients: true } } },
    }),
    prisma.household.findUniqueOrThrow({ where: { id: householdId } }),
    prisma.favourite.findMany({ where: { user: { householdId }, foodItemId: { not: null } }, select: { foodItemId: true } }),
  ]);
  const favSet = new Set(favourites.map((f) => f.foodItemId!));

  // Habitual consumption: blend of last 7 days and last 28 days, so recent changes show quickly.
  const histDays = Math.max(1, Math.min(HISTORY_DAYS, (now.getTime() - (events.reduce((m, e) => Math.min(m, e.createdAt.getTime()), now.getTime()))) / DAY_MS));
  const recentCut = addDays(today, -7);
  const hist = new Map<string, { all: number; recent: number; activeDays: Set<string> }>();
  for (const e of events) {
    if (e.source === "MEAL_PLAN") continue;
    const h = hist.get(e.foodItemId) ?? { all: 0, recent: 0, activeDays: new Set<string>() };
    h.all += -e.quantityDelta;
    if (e.createdAt >= recentCut) h.recent += -e.quantityDelta;
    h.activeDays.add(e.createdAt.toISOString().slice(0, 10));
    hist.set(e.foodItemId, h);
  }

  // Planned demand per food per day offset.
  const planned = new Map<string, number[]>();
  for (const p of plan) {
    const d = Math.floor((startOfDay(p.date).getTime() - today.getTime()) / DAY_MS);
    for (const ing of p.recipe.ingredients) {
      const arr = planned.get(ing.foodItemId) ?? new Array(HORIZON).fill(0);
      arr[d] += (ing.quantity * p.servings) / p.recipe.servings;
      planned.set(ing.foodItemId, arr);
    }
  }

  const byFood = new Map<string, typeof batches>();
  for (const b of batches) byFood.set(b.foodItemId, [...(byFood.get(b.foodItemId) ?? []), b]);

  const forecasts: ItemForecast[] = [];
  for (const f of foods) {
    const fb = (byFood.get(f.id) ?? []).sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
    const stock = fb.reduce((s, b) => s + b.remainingQuantity, 0);
    const h = hist.get(f.id);
    const plan = planned.get(f.id) ?? new Array(HORIZON).fill(0);
    const plannedTotal = plan.reduce((s, x) => s + x, 0);
    if (!stock && !h && !plannedTotal) continue; // never used, nothing in stock

    const rateAll = h ? h.all / histDays : 0;
    const rateRecent = h ? h.recent / Math.min(7, histDays) : 0;
    const habitualRate = 0.5 * rateAll + 0.5 * rateRecent;

    // Day-by-day simulation; batches are eaten soonest-expiry first and binned when they expire.
    const remaining = fb.map((b) => ({ qty: b.remainingQuantity, expDay: b.expiresAt ? Math.floor((b.expiresAt.getTime() - today.getTime()) / DAY_MS) : Infinity }));
    let runOutDay: number | null = stock <= 0 ? 0 : null;
    for (let d = 0; d < HORIZON && runOutDay === null; d++) {
      let need = habitualRate + plan[d];
      for (const b of remaining) {
        if (b.expDay < d || need <= 0) continue;
        const t = Math.min(b.qty, need);
        b.qty -= t;
        need -= t;
      }
      for (const b of remaining) if (b.expDay <= d) b.qty = 0; // expired at end of day
      if (need > 1e-6 || remaining.every((b) => b.qty <= 1e-6)) runOutDay = d;
    }

    const activeDays = h?.activeDays.size ?? 0;
    const source: ItemForecast["source"] = plannedTotal > 0 && habitualRate > 0 ? "BLEND" : plannedTotal > 0 ? "MEAL_PLAN" : "HISTORY";
    const confidence = source === "MEAL_PLAN" ? 0.85 : Math.min(0.95, 0.3 + (activeDays / HISTORY_DAYS) * 0.65 + (plannedTotal > 0 ? 0.1 : 0));
    const expiredStock = fb.filter((b) => b.expiresAt && b.expiresAt.getTime() < today.getTime()).reduce((s, b) => s + b.remainingQuantity, 0);
    const expiringSoon = fb
      .filter((b) => b.expiresAt && b.expiresAt.getTime() >= today.getTime() && b.expiresAt.getTime() < addDays(today, 3).getTime())
      .reduce((s, b) => s + b.remainingQuantity, 0);

    forecasts.push({
      foodItemId: f.id, name: f.name, category: f.category, unit: f.defaultUnit, unitSize: f.unitSize,
      isStaple: f.isStaple, isFavourite: favSet.has(f.id),
      currentStock: r1(stock),
      dailyRate: r1(habitualRate + plannedTotal / HORIZON),
      habitualRate: r1(habitualRate),
      plannedNext7: r1(plan.slice(0, 7).reduce((s, x) => s + x, 0)),
      expiringSoon: r1(expiringSoon),
      expiredStock: r1(expiredStock),
      runOutDate: runOutDay === null ? null : addDays(today, runOutDay).toISOString().slice(0, 10),
      daysLeft: runOutDay,
      confidence: Math.round(confidence * 100) / 100,
      source,
    });
  }
  forecasts.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.name.localeCompare(b.name));

  return { forecasts, proposal: proposeGroceryRun(forecasts, foods, household, today, planned) };
}

function proposeGroceryRun(
  forecasts: ItemForecast[],
  foods: FoodItem[],
  household: { groceryDayPreference: number; runThresholdDays: number },
  today: Date,
  planned: Map<string, number[]>,
): GroceryProposal {
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const dateOf = (d: number) => addDays(today, d).toISOString().slice(0, 10);
  const nextPref = [...Array(7).keys()].find((d) => addDays(today, d).getUTCDay() === household.groceryDayPreference)!;
  const weekday = addDays(today, nextPref).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

  /** Shopping lines for a trip on `day` that should last `coverDays`. */
  const itemsFor = (day: number, coverDays: number, only?: Set<string>) => {
    const items: GroceryTrip["items"] = [];
    for (const f of forecasts) {
      if (only && !only.has(f.foodItemId)) continue;
      if (f.daysLeft === null || f.daysLeft > day + coverDays || f.dailyRate <= 0) continue;
      const food = foodById.get(f.foodItemId)!;
      const plannedInWindow = (planned.get(f.foodItemId) ?? []).slice(day, day + coverDays).reduce((s, x) => s + x, 0);
      const needed = f.habitualRate * coverDays + plannedInWindow;
      const stockAtTrip = Math.max(0, f.currentStock - f.expiredStock - f.dailyRate * day);
      const shortfall = needed - stockAtTrip;
      if (shortfall <= 0 && f.daysLeft > day) continue;
      const packs = Math.max(1, Math.ceil(Math.max(shortfall, 0) / food.unitSize));
      items.push({
        foodItemId: f.foodItemId, name: f.name, packs, quantity: packs * food.unitSize, unit: f.unit, runOutDate: f.runOutDate,
        why: plannedInWindow > 0 ? "Needed for planned meals" : f.isStaple ? "Household staple" : f.isFavourite ? "Family favourite" : "Regularly used",
      });
    }
    return items;
  };

  // Items worth an extra trip: staples, favourites, or ingredients for planned meals.
  const importance = (f: ItemForecast) => (f.plannedNext7 > 0 ? 2 : 0) + (f.isStaple ? 1 : 0);
  const critical = forecasts
    .filter((f) => f.daysLeft !== null && f.daysLeft < 7 && (f.isStaple || f.isFavourite || f.plannedNext7 > 0) && f.dailyRate > 0)
    .sort((a, b) => a.daysLeft! - b.daysLeft! || importance(b) - importance(a));
  const buffer = Math.min(1, household.runThresholdDays);
  // Only things needed before the usual shop justify a top-up (meals planned on/before that day, staples, favourites).
  const plannedUntilPref = (id: string) => (planned.get(id) ?? []).slice(0, nextPref + 1).reduce((s, x) => s + x, 0);
  const beforePref = critical.filter((f) => f.daysLeft! - buffer < nextPref && (f.isStaple || f.isFavourite || plannedUntilPref(f.foodItemId) > 0));

  const main: GroceryTrip = {
    date: dateOf(nextPref),
    reason: beforePref.length
      ? `Your usual ${weekday} shop.`
      : critical.length
        ? `Your usual ${weekday} shop comes before anything important runs out.`
        : `Nothing important runs out this week — your usual ${weekday} shop is enough.`,
    urgent: nextPref <= 1 && critical.some((f) => f.daysLeft! <= nextPref),
    items: itemsFor(nextPref, 7),
  };
  if (!beforePref.length) return { ...main, topUp: null };

  // Some important items won't last until the usual day: suggest a small top-up first.
  const first = beforePref[0];
  const earliest = first.daysLeft!;
  const topDay = Math.max(0, earliest - buffer);
  let reason: string;
  if (earliest > 0) reason = `${first.name} runs out in ${earliest} day${earliest === 1 ? "" : "s"}, before your ${weekday} shop.`;
  else if (first.expiredStock > 0) reason = `${first.name} in the fridge is past its date.`;
  else reason = `${first.name} has run out.`;
  const topItems = itemsFor(topDay, Math.max(1, nextPref - topDay), new Set(beforePref.map((f) => f.foodItemId)));
  return { ...main, topUp: { date: dateOf(topDay), reason, urgent: topDay <= 1, items: topItems } };
}
