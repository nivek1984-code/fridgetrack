// Deterministic household simulator: produces ~120 days of fridge history
// (grocery runs, meal plans, cooking, snacking, spoilage) ending on `endDate`.
//
//   npm run generate                      -> ends today, seed 42
//   npm run generate -- --end 2026-10-01 --seed 7 --days 120
//
// Output goes to prisma/data/generated/*.json and is loaded by seed.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  GENERATED_DIR,
  HOUSEHOLD_ID,
  foodId,
  loadCatalog,
  loadHousehold,
  loadRecipes,
  nutritionFor,
  recipeId,
  userId,
  type CatalogEntry,
  type HabitItem,
  type HouseholdData,
  type Member,
  type RecipeEntry,
} from "./lib/data.js";

// ---------- output record types (mirror the Prisma models) ----------
export interface BatchRec {
  id: string; foodItemId: string; quantity: number; remainingQuantity: number; unit: string;
  purchasedAt: string; expiresAt: string; location: string; addedById: string;
  status: "ACTIVE" | "FINISHED" | "DISCARDED"; pricePaid: number;
}
export interface EventRec {
  id: string; batchId: string; foodItemId: string; userId: string | null;
  type: "ADDED" | "CONSUMED" | "DISCARDED"; quantityDelta: number;
  source: "GROCERY_RUN" | "MEAL_PLAN" | "SNACK" | "BREAKFAST" | "PACKED_LUNCH" | "SPOILAGE";
  mealPlanEntryId: string | null; note: string | null; createdAt: string;
}
export interface MealPlanRec {
  id: string; householdId: string; date: string; mealType: string; recipeId: string;
  servings: number; cookedAt: string | null;
}
export interface EatingLogRec {
  id: string; userId: string; date: string; mealType: string; recipeId: string | null;
  foodItemId: string | null; quantity: number | null; freeText: string | null;
  portionSize: "SMALL" | "NORMAL" | "LARGE"; kcal: number; sugarG: number;
}
export interface ShoppingRec {
  id: string; householdId: string; foodItemId: string | null; name: string; quantity: number;
  unit: string; reason: "RUN_OUT" | "EXPIRING" | "MANUAL"; addedById: string; checked: boolean; createdAt: string;
}
export interface GeneratedData {
  meta: { seed: number; tzOffsetMinutes: number; startDate: string; endDate: string; days: number; generatedBy: string; stats: Record<string, number> };
  inventoryBatches: BatchRec[];
  inventoryEvents: EventRec[];
  mealPlan: MealPlanRec[];
  eatingLogs: EatingLogRec[];
  shoppingList: ShoppingRec[];
}

export interface GenerateOptions {
  seed?: number;
  endDate?: string;
  days?: number;
  /** Minutes to add to local clock times to get UTC (Date#getTimezoneOffset). Defaults to this machine's zone. */
  tzOffsetMinutes?: number;
  /** Fixture overrides (default: the JSON files in prisma/data). */
  catalog?: CatalogEntry[];
  recipes?: RecipeEntry[];
  household?: HouseholdData;
}

// ---------- helpers ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY_MS = 86_400_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 1e-6;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

export function generateData(opts: GenerateOptions = {}): GeneratedData {
  const seed = opts.seed ?? 42;
  const tzOffset = opts.tzOffsetMinutes ?? new Date().getTimezoneOffset();
  const days = opts.days ?? 120;
  const end = new Date(`${opts.endDate ?? new Date().toLocaleDateString("en-CA")}T00:00:00Z`);
  const rand = mulberry32(seed);

  const catalog = opts.catalog ?? loadCatalog();
  const recipes = opts.recipes ?? loadRecipes();
  const hh = opts.household ?? loadHousehold();
  const members = hh.members;
  const groceryDow = hh.household.groceryDayPreference;

  const foods = new Map<string, CatalogEntry>(catalog.map((f) => [f.name, f]));
  const recipesByName = new Map<string, RecipeEntry>(recipes.map((r) => [r.name, r]));
  const food = (name: string) => {
    const f = foods.get(name);
    if (!f) throw new Error(`Unknown food "${name}"`);
    return f;
  };
  const recipe = (name: string) => {
    const r = recipesByName.get(name);
    if (!r) throw new Error(`Unknown recipe "${name}"`);
    return r;
  };
  // Validate every reference up front so bad data fails loudly.
  for (const r of recipes) for (const [n] of r.ingredients) food(n);
  for (const m of members) {
    m.favourites.recipes.forEach(recipe); m.favourites.foods.forEach(food);
    m.habits.snacks.forEach((s) => food(s.food)); m.habits.drinks.forEach((d) => food(d.food));
    m.habits.weekdayLunch.packedRecipes.forEach(recipe);
    m.habits.breakfasts.forEach((b) => (b.recipe ? recipe(b.recipe) : food(b.food!)));
    if (m.habits.picky) recipe(m.habits.picky.fallbackFood);
  }

  // Start on the grocery day on/before (end - days + 1) so day 0 is a full shop.
  let start = new Date(end.getTime() - (days - 1) * DAY_MS);
  while (start.getUTCDay() !== groceryDow) start = new Date(start.getTime() - DAY_MS);
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const dayDate = (i: number) => new Date(start.getTime() + i * DAY_MS);
  // `minutes` is a local clock time on day i; convert to a UTC timestamp.
  const ts = (i: number, minutes: number) => new Date(start.getTime() + i * DAY_MS + (minutes + tzOffset) * 60_000).toISOString();
  const dow = (i: number) => dayDate(i).getUTCDay();
  const isWeekend = (i: number) => dow(i) === 0 || dow(i) === 6;

  const chance = (p: number) => rand() < p;
  const between = (a: number, b: number) => a + rand() * (b - a);
  const randInt = (a: number, b: number) => Math.floor(between(a, b + 1));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const weighted = <T,>(items: T[], w: (t: T) => number): T | undefined => {
    const total = items.reduce((s, t) => s + w(t), 0);
    if (total <= 0) return undefined;
    let x = rand() * total;
    for (const t of items) { x -= w(t); if (x <= 0) return t; }
    return items[items.length - 1];
  };
  /** Stochastic rounding for piece-counted items (0.25 onion -> 0 or 1). */
  const roundQty = (f: CatalogEntry, q: number) => {
    if (f.unit !== "pcs") return Math.round(q * 10) / 10;
    const fl = Math.floor(q);
    return fl + (chance(q - fl) ? 1 : 0);
  };

  const hasAllergen = (m: Member, r: RecipeEntry) =>
    !!m.allergies && r.ingredients.some(([n]) => food(n).allergens && m.allergies!.split(",").some((a) => food(n).allergens!.includes(a.trim())));
  const foodAllergen = (m: Member, f: CatalogEntry) =>
    !!m.allergies && !!f.allergens && m.allergies.split(",").some((a) => f.allergens!.includes(a.trim()));

  // ---------- state ----------
  const batches: BatchRec[] = [];
  const events: EventRec[] = [];
  const mealPlan: MealPlanRec[] = [];
  const logs: EatingLogRec[] = [];
  const active = new Map<string, BatchRec[]>(); // food name -> active batches
  const grace = new Map<string, number>(); // batch id -> days eaten past expiry before binning
  const batchFood = new Map<string, string>();
  let nBatch = 0, nEvent = 0, nMeal = 0, nLog = 0;
  const cooks = ["alex", "sam"];
  const shoppers = ["alex", "sam"];
  let lastTopUp = -10;

  const stock = (name: string) => (active.get(name) ?? []).reduce((s, b) => s + b.remainingQuantity, 0);

  function addEvent(e: Omit<EventRec, "id">) {
    events.push({ id: `evt_${pad(++nEvent, 6)}`, ...e });
  }

  function buy(name: string, packs: number, at: string, dayIdx: number, by: string, freeze = false) {
    const f = food(name);
    const shelf = freeze ? 90 : Math.max(1, Math.round(f.shelfLifeDays * between(0.85, 1.15)));
    const qty = packs * f.unitSize;
    const b: BatchRec = {
      id: `batch_${pad(++nBatch, 5)}`, foodItemId: foodId(name), quantity: qty, remainingQuantity: qty, unit: f.unit,
      purchasedAt: at, expiresAt: dayDate(dayIdx + shelf).toISOString(), location: freeze ? "FREEZER" : f.location,
      addedById: userId(by), status: "ACTIVE", pricePaid: r2(packs * f.price * between(0.9, 1.1)),
    };
    batches.push(b);
    batchFood.set(b.id, name);
    grace.set(b.id, f.category === "MEAT" || f.category === "FISH" ? 0 : randInt(0, 2));
    if (!active.has(name)) active.set(name, []);
    active.get(name)!.push(b);
    active.get(name)!.sort((a, c) => a.expiresAt.localeCompare(c.expiresAt) || a.id.localeCompare(c.id));
    addEvent({ batchId: b.id, foodItemId: b.foodItemId, userId: userId(by), type: "ADDED", quantityDelta: qty, source: "GROCERY_RUN", mealPlanEntryId: null, note: null, createdAt: at });
  }

  /** FIFO (soonest expiry first) consumption. Returns the amount actually taken. */
  function consume(name: string, qty: number, at: string, by: string | null, source: EventRec["source"], mealId: string | null = null) {
    const list = active.get(name) ?? [];
    let left = qty, taken = 0;
    while (left > EPS && list.length) {
      const b = list[0];
      const take = Math.min(left, b.remainingQuantity);
      b.remainingQuantity = r2(b.remainingQuantity - take);
      left -= take; taken += take;
      addEvent({ batchId: b.id, foodItemId: b.foodItemId, userId: by ? userId(by) : null, type: "CONSUMED", quantityDelta: -r2(take), source, mealPlanEntryId: mealId, note: null, createdAt: at });
      if (b.remainingQuantity <= EPS) { b.remainingQuantity = 0; b.status = "FINISHED"; list.shift(); }
    }
    return taken;
  }

  function spoil(dayIdx: number) {
    const at = ts(dayIdx, 23 * 60 + 30);
    for (const [name, list] of active) {
      for (const b of [...list]) {
        const expDay = Math.round((new Date(b.expiresAt).getTime() - start.getTime()) / DAY_MS);
        if (expDay + grace.get(b.id)! <= dayIdx) {
          addEvent({ batchId: b.id, foodItemId: b.foodItemId, userId: null, type: "DISCARDED", quantityDelta: -b.remainingQuantity, source: "SPOILAGE", mealPlanEntryId: null, note: "Past expiry", createdAt: at });
          b.remainingQuantity = 0; b.status = "DISCARDED";
          list.splice(list.indexOf(b), 1);
        }
      }
      if (!list.length) active.delete(name);
    }
  }

  const log = (l: Omit<EatingLogRec, "id" | "portionSize" | "kcal" | "sugarG">, portion: number, kcal: number, sugar: number) => {
    logs.push({
      id: `log_${pad(++nLog, 6)}`, ...l,
      portionSize: portion < 0.8 ? "SMALL" : portion > 1.15 ? "LARGE" : "NORMAL",
      kcal: Math.round(kcal), sugarG: r2(sugar),
    });
  };
  const recipeNutrition = (r: RecipeEntry, servingsEaten: number) => {
    let kcal = 0, sugar = 0;
    for (const [n, q] of r.ingredients) {
      const nu = nutritionFor(food(n), (q * servingsEaten) / r.servings);
      kcal += nu.kcal; sugar += nu.sugar;
    }
    return { kcal, sugar };
  };
  const feasible = (r: RecipeEntry, servings: number) =>
    r.ingredients.every(([n, q]) => food(n).category === "CONDIMENTS" || stock(n) >= 0.6 * ((q * servings) / r.servings));
  /** Cook `servings` of a recipe; consumes ingredients and returns nothing. */
  const cook = (r: RecipeEntry, servings: number, at: string, by: string, source: EventRec["source"], mealId: string | null) => {
    for (const [n, q] of r.ingredients) {
      const amt = roundQty(food(n), (q * servings) / r.servings);
      if (amt > 0) consume(n, amt, at, by, source, mealId);
    }
  };
  const hasTag = (r: RecipeEntry, t: string) => r.tags.split(",").includes(t);
  /**
   * Cook a planned family meal and log each diner eating it. Every diner is checked for
   * allergens first, for every meal type. With `fallbacks` (dinner), an allergic diner
   * gets their picky-eater fallback dish if it is safe for them, and picky diners may
   * also refuse on taste; otherwise an allergic diner just skips the dish.
   */
  function serveFamilyMeal(entry: MealPlanRec, r: RecipeEntry, servings: number, t: string, by: string, diners: Member[], fallbacks = false) {
    cook(r, servings, t, by, "MEAL_PLAN", entry.id);
    entry.cookedAt = t;
    for (const m of diners) {
      const p = m.habits.portion;
      const picky = fallbacks ? m.habits.picky : undefined;
      const refuses = hasAllergen(m, r) || (!!picky && picky.refuseTags.some((tag) => hasTag(r, tag)) && chance(picky.refuseProb));
      if (refuses) {
        const fb = picky ? recipe(picky.fallbackFood) : undefined;
        if (fb && !hasAllergen(m, fb)) {
          cook(fb, p, t, by, "MEAL_PLAN", null);
          const nu = recipeNutrition(fb, p);
          log({ userId: userId(m.key), date: t, mealType: entry.mealType, recipeId: recipeId(fb.name), foodItemId: null, quantity: r2(p), freeText: `Refused ${r.name}` }, p, nu.kcal, nu.sugar);
        }
        continue;
      }
      const nu = recipeNutrition(r, p);
      log({ userId: userId(m.key), date: t, mealType: entry.mealType, recipeId: recipeId(r.name), foodItemId: null, quantity: r2(p), freeText: null }, p, nu.kcal, nu.sugar);
    }
  }

  // ---------- meal planning ----------
  const favCount = (r: RecipeEntry) => members.filter((m) => m.favourites.recipes.includes(r.name)).length;
  const dinners = recipes.filter((r) => r.mealType === "DINNER");
  const weekendBreakfasts = recipes.filter((r) => r.mealType === "BREAKFAST" && (hasTag(r, "weekend") || r.name === "Scrambled Eggs on Toast"));
  const weekendLunches = ["Tomato Soup & Toast", "Cheese Toasties", "Chickpea Salad", "Hummus Veggie Wraps", "Chicken Caesar Wraps"].map(recipe);
  const plannedDays = new Set<number>();

  function addPlan(dayIdx: number, r: RecipeEntry, servings: number, mealType = r.mealType): MealPlanRec {
    const e: MealPlanRec = { id: `meal_${pad(++nMeal, 5)}`, householdId: HOUSEHOLD_ID, date: dayDate(dayIdx).toISOString(), mealType, recipeId: recipeId(r.name), servings, cookedAt: null };
    mealPlan.push(e);
    return e;
  }
  function planWeek(from: number) {
    // Avoid repeating a dinner from the last few days of the previous week.
    const recentFrom = dayDate(from - 3).toISOString();
    const used = new Set(mealPlan.filter((e) => e.mealType === "DINNER" && e.date >= recentFrom).map((e) => nameOfRecipeId.get(e.recipeId)!.name));
    for (let k = 0; k < 7; k++) {
      const d = from + k;
      if (plannedDays.has(d)) continue;
      plannedDays.add(d);
      const w = dow(d);
      const dinner = weighted(dinners.filter((r) => !used.has(r.name)), (r) => {
        let x = 1 + favCount(r) * 1.5;
        if (w === 5 && hasTag(r, "treat")) x *= 4; // Friday treat night
        if (w === 0 && hasTag(r, "sunday")) x *= 6; // Sunday roast
        if (members.some((m) => hasAllergen(m, r))) x *= 0.5;
        return x;
      })!;
      used.add(dinner.name);
      addPlan(d, dinner, 4);
      if (w === 0 || w === 6) {
        addPlan(d, pick(weekendBreakfasts), 4);
        addPlan(d, pick(weekendLunches), 4);
        if (w === 0 && chance(0.5)) addPlan(d, recipe("Ice Cream Sundae"), 4);
      }
    }
  }
  const plansFor = (dayIdx: number) => mealPlan.filter((e) => e.date === dayDate(dayIdx).toISOString() && e.cookedAt === null);

  // ---------- shopping ----------
  const nameOfRecipeId = new Map(recipes.map((r) => [recipeId(r.name), r]));
  const avgPortion = members.reduce((s, m) => s + m.habits.portion, 0);
  function expectedDemand(fromDay: number, horizon: number) {
    const need = new Map<string, number>();
    const add = (n: string, q: number) => need.set(n, (need.get(n) ?? 0) + q);
    for (const e of mealPlan) {
      const d = Math.round((new Date(e.date).getTime() - start.getTime()) / DAY_MS);
      if (d < fromDay || d >= fromDay + horizon || e.cookedAt) continue;
      const r = nameOfRecipeId.get(e.recipeId)!;
      const servings = e.mealType === "DINNER" ? Math.ceil(avgPortion) : e.servings;
      for (const [n, q] of r.ingredients) add(n, (q * servings) / r.servings);
    }
    const weekdays = Array.from({ length: horizon }, (_, k) => fromDay + k).filter((d) => !isWeekend(d)).length;
    for (const m of members) {
      const habitDays = (h: HabitItem) => horizon + (h.weekendBoost ? (h.weekendBoost - 1) * (horizon - weekdays) : 0);
      for (const h of [...m.habits.snacks, ...m.habits.drinks]) add(h.food, h.prob * h.qty * habitDays(h));
      const totalW = m.habits.breakfasts.reduce((s, b) => s + b.weight, 0);
      for (const b of m.habits.breakfasts) {
        const times = (weekdays * (1 - m.habits.breakfastSkipProb) * b.weight) / totalW;
        if (b.recipe) { const r = recipe(b.recipe); for (const [n, q] of r.ingredients) add(n, (times * q * m.habits.portion) / r.servings); }
        else {
          add(b.food!, times * b.qty!);
          if (b.withBread) add("Wholemeal Bread", times * 80);
          if (b.withButter) add("Butter", times * 10);
          if (b.withMilk) add("Whole Milk", times * 150);
        }
      }
      const wl = m.habits.weekdayLunch;
      for (const rn of wl.packedRecipes) {
        const r = recipe(rn);
        for (const [n, q] of r.ingredients) add(n, (weekdays * wl.packedProb * q * m.habits.portion) / r.servings / wl.packedRecipes.length);
      }
    }
    return need;
  }

  function shop(dayIdx: number, minutes: number, kind: "WEEKLY" | "TOPUP") {
    const at = ts(dayIdx, minutes);
    const by = shoppers[dayIdx % 2];
    const horizon = kind === "WEEKLY" ? 8 : 3;
    const demandCache = new Map<number, Map<string, number>>();
    const demandWithin = (name: string, h: number) => {
      if (!demandCache.has(h)) demandCache.set(h, expectedDemand(dayIdx, h));
      return (demandCache.get(h)!.get(name) ?? 0) * 1.1;
    };
    for (const f of catalog) {
      const freezable = f.category === "MEAT" || f.category === "FISH";
      // Short-life produce is only bought for the days it will last; meat/fish beyond that goes in the freezer.
      const freshHorizon = f.shelfLifeDays < horizon ? Math.max(2, f.shelfLifeDays - 1) : horizon;
      const demand = demandWithin(f.name, freezable ? horizon : freshHorizon);
      const have = stock(f.name);
      let target = demand;
      if (f.isStaple) target = Math.max(target, f.unitSize * 0.5);
      if (kind === "TOPUP" && !f.isStaple && demand < f.unitSize * 0.25) continue;
      if (target - have <= EPS) continue;
      // Long-life items only get bought when they are actually needed soon.
      if (f.shelfLifeDays > 60 && have > 0 && kind === "WEEKLY" && have >= demand * 0.5) continue;
      if (kind === "WEEKLY" && !f.isStaple && chance(0.07)) continue; // forgot it
      let packs = Math.ceil((target - have) / f.unitSize);
      if (kind === "WEEKLY" && (f.category === "PRODUCE" || f.category === "BAKERY") && chance(0.12)) packs += 1; // over-buy -> waste
      if (packs <= 0) continue;
      if (freezable) {
        const freshPacks = Math.min(packs, Math.max(0, Math.ceil((demandWithin(f.name, freshHorizon) - have) / f.unitSize)));
        if (freshPacks > 0) buy(f.name, freshPacks, at, dayIdx, by);
        if (packs - freshPacks > 0) buy(f.name, packs - freshPacks, at, dayIdx, by, true);
      } else buy(f.name, packs, at, dayIdx, by);
    }
    if (kind === "WEEKLY") {
      const impulse = catalog.filter((f) => ["SNACKS", "FROZEN", "BAKERY"].includes(f.category) || (f.category === "PRODUCE" && !f.isStaple));
      for (let k = randInt(1, 3); k > 0; k--) buy(pick(impulse).name, 1, at, dayIdx, by);
    }
  }

  // ---------- daily simulation ----------
  type Action = { t: number; seq: number; run: (minutes: number) => void };
  let seq = 0;
  // On the final day ("today") stop after lunch — or at the current time if that is earlier, so nothing is in the future.
  const now = new Date();
  const cutoffMinutes = opts.endDate ? 13 * 60 : Math.max(0, Math.min(13 * 60, now.getHours() * 60 + now.getMinutes()));

  for (let i = 0; i < totalDays; i++) {
    const w = dow(i);
    const weekend = isWeekend(i);
    const isLast = i === totalDays - 1;
    const actions: Action[] = [];
    const at = (t: number, run: (minutes: number) => void) => actions.push({ t, seq: seq++, run });

    if (w === groceryDow) { planWeek(i); planWeek(i + 7); }
    else if (i === 0) planWeek(0);

    // Grocery run (first day: early, before breakfast).
    if (w === groceryDow) at(i === 0 ? 7 * 60 : 10 * 60 + randInt(0, 60), (min) => shop(i, min, "WEEKLY"));
    else if (i - lastTopUp >= 2 && w !== (groceryDow + 6) % 7) {
      at(17 * 60 + 30, () => {
        const lowStaples = catalog.filter((f) => f.isStaple && stock(f.name) < f.unitSize * 0.15);
        const blockedMeal = [i + 1, i + 2].some((d) =>
          plansFor(d).some((e) => !feasible(nameOfRecipeId.get(e.recipeId)!, e.servings)));
        if ((lowStaples.length >= 2 || blockedMeal) && chance(0.7)) { shop(i, 17 * 60 + 30, "TOPUP"); lastTopUp = i; }
      });
    }

    const todays = () => plansFor(i);
    const plan = (type: string) => todays().find((e) => e.mealType === type);

    // Breakfast
    at(7 * 60 + randInt(0, 90), (min) => {
      const t = ts(i, min);
      const fam = weekend ? plan("BREAKFAST") : undefined;
      if (fam) {
        const r = nameOfRecipeId.get(fam.recipeId)!;
        if (feasible(r, fam.servings)) return serveFamilyMeal(fam, r, fam.servings, t, cooks[i % 2], members);
      }
      for (const m of members) {
        if (chance(m.habits.breakfastSkipProb)) continue;
        const options = m.habits.breakfasts.filter((b) => (b.recipe
          ? !hasAllergen(m, recipe(b.recipe)) && feasible(recipe(b.recipe), 1)
          : !foodAllergen(m, food(b.food!)) && stock(b.food!) >= b.qty! * 0.8));
        const b = weighted(options, (o) => o.weight);
        if (!b) { log({ userId: userId(m.key), date: t, mealType: "BREAKFAST", recipeId: null, foodItemId: null, quantity: null, freeText: "Bought breakfast on the way", }, 1, 420, 22); continue; }
        const p = m.habits.portion;
        if (b.recipe) {
          const r = recipe(b.recipe);
          cook(r, p, t, m.key, "BREAKFAST", null);
          const nu = recipeNutrition(r, p);
          log({ userId: userId(m.key), date: t, mealType: "BREAKFAST", recipeId: recipeId(r.name), foodItemId: null, quantity: r2(p), freeText: null }, p, nu.kcal, nu.sugar);
        } else {
          const f = food(b.food!);
          const q = consume(f.name, b.qty!, t, m.key, "BREAKFAST");
          const nu = nutritionFor(f, q);
          let kcal = nu.kcal, sugar = nu.sugar;
          const extra = (n: string, qq: number) => { const got = consume(n, qq, t, m.key, "BREAKFAST"); const e = nutritionFor(food(n), got); kcal += e.kcal; sugar += e.sugar; };
          if (b.withBread) extra("Wholemeal Bread", 80);
          if (b.withButter) extra("Butter", 10);
          if (b.withMilk) extra("Whole Milk", 150);
          log({ userId: userId(m.key), date: t, mealType: "BREAKFAST", recipeId: null, foodItemId: foodId(f.name), quantity: q, freeText: null }, 1, kcal, sugar);
        }
      }
    });

    // Lunch
    at(12 * 60 + randInt(0, 45), (min) => {
      const t = ts(i, min);
      const fam = weekend ? plan("LUNCH") : undefined;
      if (fam) {
        const r = nameOfRecipeId.get(fam.recipeId)!;
        if (feasible(r, fam.servings)) return serveFamilyMeal(fam, r, fam.servings, t, cooks[(i + 1) % 2], members);
      }
      for (const m of members) {
        const wl = m.habits.weekdayLunch;
        const p = m.habits.portion;
        const options = wl.packedRecipes.map(recipe).filter((r) => !hasAllergen(m, r) && feasible(r, p));
        if (!weekend && options.length && chance(wl.packedProb)) {
          const r = pick(options);
          cook(r, p, t, m.key, "PACKED_LUNCH", null);
          const nu = recipeNutrition(r, p);
          log({ userId: userId(m.key), date: t, mealType: "LUNCH", recipeId: recipeId(r.name), foodItemId: null, quantity: r2(p), freeText: "Packed lunch" }, p, nu.kcal, nu.sugar);
        } else {
          const text = weekend ? "Lunch out with friends" : pick(wl.outText);
          const est = hh.eatOutEstimates[text] ?? { kcal: 700, sugar: 15 };
          const n = between(0.9, 1.1);
          log({ userId: userId(m.key), date: t, mealType: "LUNCH", recipeId: null, foodItemId: null, quantity: null, freeText: text }, 1, est.kcal * n, est.sugar * n);
        }
      }
    });

    // Snacks & drinks spread across the day
    for (const m of members) {
      for (const h of m.habits.snacks) {
        const p = h.prob * (weekend && h.weekendBoost ? h.weekendBoost : 1);
        if (!chance(Math.min(p, 0.98))) continue;
        const t = h.lateNight ? 21 * 60 + randInt(15, 105) : 10 * 60 + randInt(0, 420);
        at(t, () => snack(m, h, ts(i, t), "SNACK"));
      }
      for (const h of m.habits.drinks) {
        const p = h.prob * (weekend && h.weekendBoost ? h.weekendBoost : 1);
        if (!chance(Math.min(p, 0.98))) continue;
        const t = h.food === "Coffee Beans" || h.food === "Oat Milk" ? 7 * 60 + randInt(0, 60) : 9 * 60 + randInt(0, 720);
        at(t, () => snack(m, h, ts(i, t), "DRINK"));
      }
    }

    // Dinner
    at(18 * 60 + randInt(0, 60), (min) => {
      const t = ts(i, min);
      const planned = plan("DINNER");
      const takeaway = () => {
        const text = pick(hh.familyTakeaways);
        const est = hh.eatOutEstimates[text];
        for (const m of members) {
          const p = m.habits.portion;
          log({ userId: userId(m.key), date: t, mealType: "DINNER", recipeId: null, foodItemId: null, quantity: null, freeText: text }, p, est.kcal * p * between(0.9, 1.1), est.sugar * p);
        }
      };
      if (chance(w === 5 ? 0.15 : 0.04)) return takeaway();
      const home = members.filter((m) => {
        if (chance(m.habits.dinnerOutProb)) {
          const est = hh.eatOutEstimates["Dinner at friends"];
          log({ userId: userId(m.key), date: t, mealType: "DINNER", recipeId: null, foodItemId: null, quantity: null, freeText: "Dinner at friends" }, 1, est.kcal * m.habits.portion, est.sugar);
          return false;
        }
        return true;
      });
      if (!home.length) return;
      const servings = Math.max(2, Math.ceil(home.reduce((s, m) => s + m.habits.portion, 0)));
      let r = planned ? nameOfRecipeId.get(planned.recipeId)! : undefined;
      let entry = planned;
      if (!r || !feasible(r, servings)) {
        // Planned meal can't be made: "use what we have" instead.
        const alt = weighted(dinners.filter((d) => feasible(d, servings)), (d) => 1 + favCount(d));
        if (!alt) return takeaway();
        r = alt;
        entry = addPlan(i, alt, servings);
      }
      serveFamilyMeal(entry!, r, servings, t, cooks[i % 2], home, true);
    });

    // Planned dessert
    at(20 * 60, () => {
      const d = plan("SNACK");
      if (!d) return;
      const r = nameOfRecipeId.get(d.recipeId)!;
      if (!feasible(r, d.servings)) return;
      serveFamilyMeal(d, r, d.servings, ts(i, 20 * 60), cooks[i % 2], members);
    });

    actions.sort((a, b) => a.t - b.t || a.seq - b.seq);
    for (const a of actions) {
      if (isLast && a.t >= cutoffMinutes) continue;
      a.run(a.t);
    }
    if (!isLast) spoil(i);
  }

  function snack(m: Member, h: HabitItem, t: string, mealType: "SNACK" | "DRINK") {
    const f = food(h.food);
    if (foodAllergen(m, f)) return;
    const want = roundQty(f, h.qty * between(0.8, 1.2));
    if (want <= 0) return;
    const got = consume(f.name, want, t, m.key, "SNACK");
    if (got <= EPS) return; // nothing left in the fridge
    const nu = nutritionFor(f, got);
    log({ userId: userId(m.key), date: t, mealType, recipeId: null, foodItemId: foodId(f.name), quantity: r2(got), freeText: null }, 1, nu.kcal, nu.sugar);
  }

  // ---------- open shopping list for "today" ----------
  const lastDay = totalDays - 1;
  const nowIso = ts(lastDay, cutoffMinutes);
  const shoppingList: ShoppingRec[] = [];
  let nShop = 0;
  const addShop = (s: Omit<ShoppingRec, "id" | "householdId" | "checked" | "createdAt">) =>
    shoppingList.push({ id: `shop_${pad(++nShop, 3)}`, householdId: HOUSEHOLD_ID, checked: false, createdAt: nowIso, ...s });
  const weekNeed = expectedDemand(lastDay, 7);
  for (const f of catalog) {
    if (!f.isStaple) continue;
    const have = stock(f.name);
    const need = Math.max(weekNeed.get(f.name) ?? 0, f.unitSize * 0.5);
    if (have < need * 0.3) addShop({ foodItemId: foodId(f.name), name: f.name, quantity: Math.max(1, Math.ceil((need - have) / f.unitSize)) * f.unitSize, unit: f.unit, reason: "RUN_OUT", addedById: userId("alex") });
  }
  addShop({ foodItemId: null, name: "Birthday cake for Mia", quantity: 1, unit: "pcs", reason: "MANUAL", addedById: userId("sam") });
  addShop({ foodItemId: foodId("Strawberries"), name: "Strawberries", quantity: 400, unit: "g", reason: "MANUAL", addedById: userId("mia") });
  addShop({ foodItemId: foodId("Protein Bars"), name: "Protein Bars", quantity: 6, unit: "pcs", reason: "MANUAL", addedById: userId("jordan") });

  const stats = {
    batches: batches.length,
    events: events.length,
    mealPlanEntries: mealPlan.length,
    upcomingMeals: mealPlan.filter((e) => e.date > nowIso).length,
    eatingLogs: logs.length,
    activeBatches: batches.filter((b) => b.status === "ACTIVE").length,
    discardedBatches: batches.filter((b) => b.status === "DISCARDED").length,
    shoppingListItems: shoppingList.length,
  };

  return {
    meta: { seed, tzOffsetMinutes: tzOffset, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), days: totalDays, generatedBy: "prisma/generate.ts", stats },
    inventoryBatches: batches,
    inventoryEvents: events,
    mealPlan: mealPlan.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    eatingLogs: logs,
    shoppingList,
  };
}

export function writeGenerated(data: GeneratedData, dir = GENERATED_DIR) {
  mkdirSync(dir, { recursive: true });
  const files: [string, unknown][] = [
    ["meta.json", data.meta],
    ["inventoryBatches.json", data.inventoryBatches],
    ["inventoryEvents.json", data.inventoryEvents],
    ["mealPlan.json", data.mealPlan],
    ["eatingLogs.json", data.eatingLogs],
    ["shoppingList.json", data.shoppingList],
  ];
  for (const [f, v] of files) writeFileSync(join(dir, f), JSON.stringify(v, null, 1) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const data = generateData({ seed: arg("seed") ? Number(arg("seed")) : undefined, endDate: arg("end"), days: arg("days") ? Number(arg("days")) : undefined });
  writeGenerated(data);
  console.log(`Generated ${data.meta.startDate} -> ${data.meta.endDate} (seed ${data.meta.seed})`);
  console.table(data.meta.stats);
}
