// Shared loaders and ID helpers for the static reference data in prisma/data/.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
export const GENERATED_DIR = join(DATA_DIR, "generated");

export interface CatalogEntry {
  name: string;
  category: string;
  unit: "g" | "ml" | "pcs";
  unitSize: number;
  shelfLifeDays: number;
  location: "FRIDGE" | "FREEZER" | "PANTRY";
  isDrink: boolean;
  isStaple: boolean;
  price: number;
  kcal: number;
  protein: number;
  sugar: number;
  satFat: number;
  fibre: number;
  sodium: number;
  gramsPerPiece?: number;
  allergens?: string;
}

export interface RecipeEntry {
  name: string;
  mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
  servings: number;
  prepMinutes: number;
  tags: string;
  instructions: string;
  ingredients: [string, number][];
}

export interface HabitItem {
  food: string;
  qty: number;
  prob: number;
  lateNight?: boolean;
  weekendBoost?: number;
}

export interface BreakfastOption {
  recipe?: string;
  food?: string;
  qty?: number;
  withBread?: boolean;
  withButter?: boolean;
  withMilk?: boolean;
  weight: number;
}

export interface Member {
  key: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  birthYear: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
  dietaryGoals: string;
  allergies: string | null;
  dietType: string;
  favourites: { recipes: string[]; foods: string[] };
  habits: {
    portion: number;
    breakfastSkipProb: number;
    breakfasts: BreakfastOption[];
    weekdayLunch: { packedProb: number; packedRecipes: string[]; outText: string[] };
    dinnerOutProb: number;
    picky?: { refuseTags: string[]; refuseProb: number; fallbackFood: string };
    snacks: HabitItem[];
    drinks: HabitItem[];
  };
}

export interface HouseholdData {
  household: { name: string; groceryDayPreference: number; runThresholdDays: number };
  members: Member[];
  eatOutEstimates: Record<string, { kcal: number; sugar: number }>;
  familyTakeaways: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T;
}

export const loadCatalog = () => readJson<CatalogEntry[]>("foodCatalog.json");
export const loadRecipes = () => readJson<RecipeEntry[]>("recipes.json");
export const loadHousehold = () => readJson<HouseholdData>("household.json");

export const slug = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const HOUSEHOLD_ID = "household_demo";
export const userId = (key: string) => `user_${key}`;
export const foodId = (name: string) => `food_${slug(name)}`;
export const recipeId = (name: string) => `recipe_${slug(name)}`;

/** Nutrition for `qty` of a food in its default unit (per 100 g/ml, or per piece). */
export function nutritionFor(food: CatalogEntry, qty: number) {
  const factor = food.unit === "pcs" ? qty : qty / 100;
  return { kcal: food.kcal * factor, sugar: food.sugar * factor };
}
