// Per-member nutrition rollups and rule-based health flags.
// Reference values are rough public-health guidelines (UK/WHO), used for
// orientation only — this is not medical advice.
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { addDays, r1, startOfDay } from "../http.js";
import { nutritionFor } from "./inventory.js";

const ALCOHOL_ABV: Record<string, number> = { beer: 0.045, wine: 0.12, cider: 0.05 };
const NOT_FRUIT_VEG = /potato|chips/i;

export interface Rollup {
  days: number;
  daysLogged: number;
  perDay: { kcal: number; proteinG: number; sugarG: number; satFatG: number; fibreG: number; sodiumMg: number; fruitVegG: number; sugaryDrinksMl: number; waterMl: number };
  alcoholUnitsPerWeek: number;
  lateNightSnacksPerWeek: number;
  mealsEatenOutPerWeek: number;
  breakfastsSkippedPerWeek: number;
  topFoods: { name: string; times: number }[];
  topSugarSources: { name: string; sugarG: number }[];
}

export interface Targets { kcal: number; sugarG: number; satFatG: number; fibreG: number; sodiumMg: number; fruitVegG: number; proteinG: number }

export interface Flag { level: "good" | "warn" | "bad"; area: string; message: string }

export function ageOf(u: Pick<User, "birthYear">, now = new Date()) {
  return u.birthYear ? now.getUTCFullYear() - u.birthYear : 35;
}

const ACTIVITY: Record<string, number> = { SEDENTARY: 1.2, LIGHT: 1.375, MODERATE: 1.55, ACTIVE: 1.725, VERY_ACTIVE: 1.9 };

export function targetsFor(u: User, now = new Date()): Targets {
  const age = ageOf(u, now);
  const act = ACTIVITY[u.activityLevel ?? "MODERATE"] ?? 1.55;
  let kcal: number;
  if (age >= 18 && u.weightKg && u.heightCm) {
    // Mifflin-St Jeor
    const bmr = 10 * u.weightKg + 6.25 * u.heightCm - 5 * age + (u.sex === "M" ? 5 : u.sex === "F" ? -161 : -78);
    kcal = bmr * act;
  } else {
    // Rough estimated energy requirement for children/teens
    const base = age < 4 ? 1100 : age < 9 ? 1500 : age < 14 ? 1900 : u.sex === "M" ? 2500 : 2100;
    kcal = base * (act / 1.55);
  }
  const child = age < 11;
  const teen = age >= 11 && age < 18;
  return {
    kcal: Math.round(kcal),
    sugarG: child ? 60 : teen ? 80 : 90, // total sugars reference intake
    satFatG: child ? 18 : u.sex === "M" ? 30 : 20,
    fibreG: child ? 20 : teen ? 25 : 30,
    sodiumMg: child ? 1200 : 2400,
    fruitVegG: child ? 320 : 400,
    proteinG: Math.round((u.weightKg ?? 60) * (teen || u.activityLevel === "VERY_ACTIVE" ? 1.2 : 0.8)),
  };
}

export async function rollupFor(userId: string, days = 14, now = new Date()): Promise<Rollup> {
  const since = addDays(startOfDay(now), -days + 1);
  const logs = await prisma.eatingLog.findMany({
    where: { userId, date: { gte: since, lte: now } },
    include: { foodItem: true, recipe: { include: { ingredients: { include: { foodItem: true } } } } },
  });
  const t = { kcal: 0, proteinG: 0, sugarG: 0, satFatG: 0, fibreG: 0, sodiumMg: 0, fruitVegG: 0, sugaryDrinksMl: 0, waterMl: 0 };
  let alcoholUnits = 0, lateNight = 0, eatOut = 0;
  const foodCounts = new Map<string, number>();
  const sugarBy = new Map<string, number>();
  const breakfastDays = new Set<string>();
  const loggedDays = new Set<string>();

  for (const l of logs) {
    const day = l.date.toISOString().slice(0, 10);
    loggedDays.add(day);
    if (l.mealType === "BREAKFAST") breakfastDays.add(day);
    const hour = l.date.getHours(); // server-local time
    const label = l.recipe?.name ?? l.foodItem?.name ?? l.freeText ?? "Other";
    foodCounts.set(label, (foodCounts.get(label) ?? 0) + 1);

    let sugar = 0;
    if (l.recipe) {
      const k = (l.quantity ?? 1) / l.recipe.servings;
      for (const ing of l.recipe.ingredients) {
        const qty = ing.quantity * k;
        const n = nutritionFor(ing.foodItem, qty);
        t.kcal += n.kcal; t.proteinG += n.proteinG; t.satFatG += n.satFatG; t.fibreG += n.fibreG; t.sodiumMg += n.sodiumMg;
        sugar += n.sugarG;
        if (ing.foodItem.category === "PRODUCE" && !NOT_FRUIT_VEG.test(ing.foodItem.name)) {
          t.fruitVegG += ing.foodItem.defaultUnit === "pcs" ? qty * (ing.foodItem.gramsPerPiece ?? 80) : qty;
        }
      }
    } else if (l.foodItem) {
      const f = l.foodItem;
      const qty = l.quantity ?? 0;
      const n = nutritionFor(f, qty);
      t.kcal += n.kcal; t.proteinG += n.proteinG; t.satFatG += n.satFatG; t.fibreG += n.fibreG; t.sodiumMg += n.sodiumMg;
      sugar += n.sugarG;
      if (f.category === "PRODUCE" && !NOT_FRUIT_VEG.test(f.name)) t.fruitVegG += f.defaultUnit === "pcs" ? qty * (f.gramsPerPiece ?? 80) : qty;
      if (f.isDrink && f.defaultUnit === "ml") {
        if ((f.sugarG ?? 0) >= 5) t.sugaryDrinksMl += qty;
        if (/water/i.test(f.name)) t.waterMl += qty;
        const abv = Object.entries(ALCOHOL_ABV).find(([k]) => f.name.toLowerCase().includes(k))?.[1];
        if (abv) alcoholUnits += (qty * abv) / 10; // UK unit = 10 ml pure alcohol
      }
      if ((l.mealType === "SNACK" || (l.mealType === "DRINK" && (f.kcal ?? 0) > 20)) && hour >= 21) lateNight++;
    } else {
      // Free-text meal (eaten out): only the estimate is known.
      t.kcal += l.kcal ?? 0;
      sugar += l.sugarG ?? 0;
      eatOut++;
    }
    t.sugarG += sugar;
    sugarBy.set(label, (sugarBy.get(label) ?? 0) + sugar);
  }

  const weeks = days / 7;
  const perDay = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r1(v / days)])) as Rollup["perDay"];
  return {
    days,
    daysLogged: loggedDays.size,
    perDay,
    alcoholUnitsPerWeek: r1(alcoholUnits / weeks),
    lateNightSnacksPerWeek: r1(lateNight / weeks),
    mealsEatenOutPerWeek: r1(eatOut / weeks),
    breakfastsSkippedPerWeek: r1(Math.max(0, loggedDays.size - breakfastDays.size) / weeks),
    topFoods: [...foodCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, times]) => ({ name, times })),
    topSugarSources: [...sugarBy].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, s]) => ({ name, sugarG: r1(s / days) })),
  };
}

export function flagsFor(r: Rollup, tg: Targets, age: number): Flag[] {
  const f: Flag[] = [];
  const p = r.perDay;
  const pct = (a: number, b: number) => Math.round((a / b) * 100);
  const kcalRatio = p.kcal / tg.kcal;
  if (kcalRatio > 1.15) f.push({ level: kcalRatio > 1.3 ? "bad" : "warn", area: "Energy", message: `Eating about ${pct(p.kcal, tg.kcal)}% of estimated needs (${Math.round(p.kcal)} vs ~${tg.kcal} kcal/day).` });
  else if (kcalRatio < 0.8) f.push({ level: "warn", area: "Energy", message: `Logged intake is low: ${Math.round(p.kcal)} vs ~${tg.kcal} kcal/day (meals may be missing from the log).` });
  else f.push({ level: "good", area: "Energy", message: `Energy intake is close to estimated needs (~${tg.kcal} kcal/day).` });

  if (p.sugarG > tg.sugarG * 1.25) f.push({ level: "bad", area: "Sugar", message: `${Math.round(p.sugarG)} g sugar/day, well above the ~${tg.sugarG} g reference.` });
  else if (p.sugarG > tg.sugarG) f.push({ level: "warn", area: "Sugar", message: `${Math.round(p.sugarG)} g sugar/day, a bit above the ~${tg.sugarG} g reference.` });
  else f.push({ level: "good", area: "Sugar", message: `Sugar intake within reference (${Math.round(p.sugarG)} g/day).` });

  if (p.sugaryDrinksMl > 250) f.push({ level: p.sugaryDrinksMl > 500 ? "bad" : "warn", area: "Drinks", message: `${Math.round(p.sugaryDrinksMl)} ml of sugary drinks a day (juice, soda, energy/sports drinks).` });
  if (p.fruitVegG < tg.fruitVegG * 0.6) f.push({ level: "bad", area: "Fruit & veg", message: `Only ~${Math.round(p.fruitVegG / 80)} portions of fruit & veg a day (aim for 5).` });
  else if (p.fruitVegG < tg.fruitVegG) f.push({ level: "warn", area: "Fruit & veg", message: `~${Math.round(p.fruitVegG / 80)} portions of fruit & veg a day — nearly at 5.` });
  else f.push({ level: "good", area: "Fruit & veg", message: `Hitting 5-a-day (~${Math.round(p.fruitVegG / 80)} portions).` });

  if (p.fibreG < tg.fibreG * 0.7) f.push({ level: "warn", area: "Fibre", message: `${Math.round(p.fibreG)} g fibre/day vs ~${tg.fibreG} g recommended.` });
  if (p.satFatG > tg.satFatG * 1.2) f.push({ level: "warn", area: "Saturated fat", message: `${Math.round(p.satFatG)} g saturated fat/day vs ~${tg.satFatG} g limit.` });
  if (p.sodiumMg > tg.sodiumMg * 1.2) f.push({ level: "warn", area: "Salt", message: `~${r1((p.sodiumMg * 2.5) / 1000)} g salt/day vs ~${r1((tg.sodiumMg * 2.5) / 1000)} g limit.` });
  if (p.proteinG < tg.proteinG * 0.8) f.push({ level: "warn", area: "Protein", message: `${Math.round(p.proteinG)} g protein/day vs ~${tg.proteinG} g target.` });
  if (age >= 18 && r.alcoholUnitsPerWeek > 14) f.push({ level: "bad", area: "Alcohol", message: `~${r.alcoholUnitsPerWeek} units/week, above the 14-unit guideline.` });
  else if (age >= 18 && r.alcoholUnitsPerWeek > 7) f.push({ level: "warn", area: "Alcohol", message: `~${r.alcoholUnitsPerWeek} units/week.` });
  if (r.lateNightSnacksPerWeek >= 3) f.push({ level: "warn", area: "Late-night snacking", message: `${r.lateNightSnacksPerWeek} late-night snacks a week.` });
  if (r.breakfastsSkippedPerWeek >= 2) f.push({ level: "warn", area: "Breakfast", message: `Skipping breakfast ~${r.breakfastsSkippedPerWeek} times a week.` });
  if (r.mealsEatenOutPerWeek >= 5 && age >= 14) f.push({ level: "warn", area: "Eating out", message: `${r.mealsEatenOutPerWeek} meals a week from takeaways/canteens.` });
  return f;
}

/** 1–10 score from the rule-based flags. */
export function ruleScore(flags: Flag[]) {
  const penalty = flags.reduce((s, f) => s + (f.level === "bad" ? 1.5 : f.level === "warn" ? 0.6 : 0), 0);
  return Math.max(1, Math.min(10, Math.round(10 - penalty)));
}
