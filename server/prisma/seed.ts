// Wipes the database and loads static reference data + generated history.
// Run `npm run generate` first (or pass --generate to do both).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  GENERATED_DIR,
  HOUSEHOLD_ID,
  foodId,
  loadCatalog,
  loadHousehold,
  loadRecipes,
  recipeId,
  userId,
} from "./lib/data.js";
import { generateData, writeGenerated, type GeneratedData } from "./generate.js";

const prisma = new PrismaClient();
const CHUNK = 500;

async function createInChunks<T>(rows: T[], create: (data: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await create(rows.slice(i, i + CHUNK));
}

function loadGenerated(): GeneratedData {
  if (process.argv.includes("--generate") || !existsSync(join(GENERATED_DIR, "meta.json"))) {
    const data = generateData();
    writeGenerated(data);
    return data;
  }
  const read = (f: string) => JSON.parse(readFileSync(join(GENERATED_DIR, f), "utf8"));
  return {
    meta: read("meta.json"),
    inventoryBatches: read("inventoryBatches.json"),
    inventoryEvents: read("inventoryEvents.json"),
    mealPlan: read("mealPlan.json"),
    eatingLogs: read("eatingLogs.json"),
    shoppingList: read("shoppingList.json"),
  };
}

async function main() {
  const catalog = loadCatalog();
  const recipes = loadRecipes();
  const hh = loadHousehold();
  const gen = loadGenerated();

  // Children first so foreign keys are never violated.
  await prisma.healthReport.deleteMany();
  await prisma.prediction.deleteMany();
  await prisma.shoppingListItem.deleteMany();
  await prisma.eatingLog.deleteMany();
  await prisma.favourite.deleteMany();
  await prisma.mealPlanEntry.deleteMany();
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.inventoryEvent.deleteMany();
  await prisma.inventoryBatch.deleteMany();
  await prisma.foodItem.deleteMany();
  await prisma.user.deleteMany();
  await prisma.household.deleteMany();

  await prisma.household.create({ data: { id: HOUSEHOLD_ID, ...hh.household } });

  const passwordHash = await bcrypt.hash(hh.defaultPassword, 10);
  await prisma.user.createMany({
    data: hh.members.map((m) => ({
      id: userId(m.key), householdId: HOUSEHOLD_ID, name: m.name, email: m.email, passwordHash, role: m.role,
      birthYear: m.birthYear, sex: m.sex, heightCm: m.heightCm, weightKg: m.weightKg, activityLevel: m.activityLevel,
      dietaryGoals: m.dietaryGoals, allergies: m.allergies, dietType: m.dietType,
    })),
  });

  await prisma.foodItem.createMany({
    data: catalog.map((f) => ({
      id: foodId(f.name), householdId: HOUSEHOLD_ID, name: f.name, category: f.category, defaultUnit: f.unit,
      unitSize: f.unitSize, typicalShelfLifeDays: f.shelfLifeDays, location: f.location, isDrink: f.isDrink,
      isStaple: f.isStaple, pricePerPack: f.price, kcal: f.kcal, proteinG: f.protein, sugarG: f.sugar,
      satFatG: f.satFat, fibreG: f.fibre, sodiumMg: f.sodium, gramsPerPiece: f.gramsPerPiece ?? null,
      allergens: f.allergens ?? null,
    })),
  });

  const unitOf = new Map(catalog.map((f) => [f.name, f.unit]));
  for (const [i, r] of recipes.entries()) {
    await prisma.recipe.create({
      data: {
        id: recipeId(r.name), householdId: HOUSEHOLD_ID, name: r.name, mealType: r.mealType, servings: r.servings,
        prepMinutes: r.prepMinutes, instructions: r.instructions, tags: r.tags,
        createdById: userId(hh.members[i % 2].key),
        ingredients: {
          create: r.ingredients.map(([name, qty]) => ({ foodItemId: foodId(name), quantity: qty, unit: unitOf.get(name)! })),
        },
      },
    });
  }

  await prisma.favourite.createMany({
    data: hh.members.flatMap((m) => [
      ...m.favourites.recipes.map((r) => ({ userId: userId(m.key), recipeId: recipeId(r) })),
      ...m.favourites.foods.map((f) => ({ userId: userId(m.key), foodItemId: foodId(f) })),
    ]),
  });

  const d = (s: string | null) => (s ? new Date(s) : null);
  await createInChunks(gen.inventoryBatches, (rows) =>
    prisma.inventoryBatch.createMany({ data: rows.map((b) => ({ ...b, purchasedAt: new Date(b.purchasedAt), expiresAt: d(b.expiresAt) })) }));
  await createInChunks(gen.inventoryEvents, (rows) =>
    prisma.inventoryEvent.createMany({ data: rows.map((e) => ({ ...e, createdAt: new Date(e.createdAt) })) }));
  await createInChunks(gen.mealPlan, (rows) =>
    prisma.mealPlanEntry.createMany({ data: rows.map((m) => ({ ...m, date: new Date(m.date), cookedAt: d(m.cookedAt) })) }));
  await createInChunks(gen.eatingLogs, (rows) =>
    prisma.eatingLog.createMany({ data: rows.map((l) => ({ ...l, date: new Date(l.date) })) }));
  await prisma.shoppingListItem.createMany({ data: gen.shoppingList.map((s) => ({ ...s, createdAt: new Date(s.createdAt) })) });

  console.log(`Seeded "${hh.household.name}" with history ${gen.meta.startDate} -> ${gen.meta.endDate}`);
  console.log(`Logins: ${hh.members.map((m) => m.email).join(", ")} (password: ${hh.defaultPassword})`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
