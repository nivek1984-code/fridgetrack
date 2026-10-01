// Wipes the database and loads static reference data + generated history.
// Run `npm run generate` first (or pass --generate to do both).
// Refuses to run against anything but a local SQLite file outside production unless ALLOW_DESTRUCTIVE_SEED=1.
import "dotenv/config";
import { randomBytes } from "node:crypto";
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

const CHUNK = 500;
const DEV_PASSWORD = "demo1234";

// Seeding deletes every table, so only allow it where that can't hurt.
function checkTarget(): { password: string; isDevDefault: boolean } {
  const isProd = process.env.NODE_ENV === "production";
  const isLocalFile = (process.env.DATABASE_URL ?? "").startsWith("file:");
  if ((isProd || !isLocalFile) && process.env.ALLOW_DESTRUCTIVE_SEED !== "1") {
    throw new Error(
      `Refusing to seed: it wipes every table, and the target is ${isProd ? "NODE_ENV=production" : "not a local file: database"}. ` +
      "Set ALLOW_DESTRUCTIVE_SEED=1 if you really mean it.",
    );
  }
  const password = process.env.SEED_PASSWORD;
  if (password) return { password, isDevDefault: false };
  if (isProd || !isLocalFile) throw new Error("Set SEED_PASSWORD when seeding a non-development database.");
  return { password: DEV_PASSWORD, isDevDefault: true };
}

const target = checkTarget();
const prisma = new PrismaClient();

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

  // Hash outside the transaction (bcrypt is slow) and per user, so accounts don't share a hash.
  const passwordHashes = await Promise.all(hh.members.map(() => bcrypt.hash(target.password, 10)));
  const inviteCode = randomBytes(4).toString("hex").toUpperCase();

  // One transaction, so a failure partway through leaves the old data in place.
  await prisma.$transaction(async (tx) => {
    // Children first so foreign keys are never violated.
    await tx.healthReport.deleteMany();
    await tx.prediction.deleteMany();
    await tx.shoppingListItem.deleteMany();
    await tx.eatingLog.deleteMany();
    await tx.favourite.deleteMany();
    await tx.mealPlanEntry.deleteMany();
    await tx.recipeIngredient.deleteMany();
    await tx.recipe.deleteMany();
    await tx.inventoryEvent.deleteMany();
    await tx.inventoryBatch.deleteMany();
    await tx.foodItem.deleteMany();
    await tx.user.deleteMany();
    await tx.household.deleteMany();

    await tx.household.create({ data: { id: HOUSEHOLD_ID, inviteCode, ...hh.household } });

    await tx.user.createMany({
      data: hh.members.map((m, i) => ({
        id: userId(m.key), householdId: HOUSEHOLD_ID, name: m.name, email: m.email.trim().toLowerCase(),
        passwordHash: passwordHashes[i], role: m.role,
        birthYear: m.birthYear, sex: m.sex, heightCm: m.heightCm, weightKg: m.weightKg, activityLevel: m.activityLevel,
        dietaryGoals: m.dietaryGoals, allergies: m.allergies, dietType: m.dietType,
      })),
    });

    await tx.foodItem.createMany({
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
      await tx.recipe.create({
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

    await tx.favourite.createMany({
      data: hh.members.flatMap((m) => [
        ...m.favourites.recipes.map((r) => ({ userId: userId(m.key), recipeId: recipeId(r) })),
        ...m.favourites.foods.map((f) => ({ userId: userId(m.key), foodItemId: foodId(f) })),
      ]),
    });

    const d = (s: string | null) => (s ? new Date(s) : null);
    await createInChunks(gen.inventoryBatches, (rows) =>
      tx.inventoryBatch.createMany({ data: rows.map((b) => ({ ...b, purchasedAt: new Date(b.purchasedAt), expiresAt: d(b.expiresAt) })) }));
    await createInChunks(gen.inventoryEvents, (rows) =>
      tx.inventoryEvent.createMany({ data: rows.map((e) => ({ ...e, createdAt: new Date(e.createdAt) })) }));
    await createInChunks(gen.mealPlan, (rows) =>
      tx.mealPlanEntry.createMany({ data: rows.map((m) => ({ ...m, date: new Date(m.date), cookedAt: d(m.cookedAt) })) }));
    await createInChunks(gen.eatingLogs, (rows) =>
      tx.eatingLog.createMany({ data: rows.map((l) => ({ ...l, date: new Date(l.date) })) }));
    await tx.shoppingListItem.createMany({ data: gen.shoppingList.map((s) => ({ ...s, createdAt: new Date(s.createdAt) })) });
  }, { maxWait: 10_000, timeout: 300_000 });

  console.log(`Seeded "${hh.household.name}" with history ${gen.meta.startDate} -> ${gen.meta.endDate}`);
  console.log(`Logins: ${hh.members.map((m) => m.email).join(", ")}`
    + (target.isDevDefault ? ` (password: ${DEV_PASSWORD})` : " (password: from SEED_PASSWORD)"));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
