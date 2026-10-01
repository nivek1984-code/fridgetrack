// AI health reports: sends a member's profile, nutrition rollup and rule-based
// flags to Claude and stores the structured result as a HealthReport.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../http.js";
import { stockByFood } from "./inventory.js";
import { ageOf, flagsFor, rollupFor, ruleScore, targetsFor } from "./nutrition.js";

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export const ReportSchema = z.object({
  score: z.number().int().min(1).max(10).describe("Overall eating-habit score, 1 (poor) to 10 (excellent)"),
  summary: z.string().describe("2-3 sentence plain-language overview addressed to the member"),
  strengths: z.array(z.string()).describe("Things they are doing well"),
  concerns: z.array(z.object({
    issue: z.string(),
    why: z.string().describe("Why it matters for someone of this age/goal"),
    severity: z.enum(["low", "medium", "high"]),
  })),
  swaps: z.array(z.object({
    instead: z.string().describe("Current habit or food"),
    try: z.string().describe("Healthier alternative, preferably something already in the fridge"),
    why: z.string(),
  })).describe("3-5 concrete, realistic swaps"),
  shoppingSuggestions: z.array(z.object({ name: z.string(), reason: z.string() })).describe("Items to add to the family shopping list"),
  encouragement: z.string().describe("One short, warm closing line"),
});
export type Report = z.infer<typeof ReportSchema>;

const SYSTEM = `You are a friendly family nutrition coach inside a household grocery app.
You review one family member's recent eating log (already summarised into numbers) and give practical, kind, specific feedback.
- Tailor advice to their age, activity level, goals and allergies. Never suggest foods they are allergic to.
- For children, address the advice to the parents and keep it positive (no weight talk).
- Prefer swaps using foods the family already buys or has in the fridge.
- Base every claim on the data provided; if the log looks incomplete, say so rather than guessing.
- You are not a doctor: don't diagnose; suggest seeing a professional only for genuinely concerning patterns.`;

export async function healthContext(userId: string, days: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { favourites: { include: { foodItem: true, recipe: true } } } });
  const rollup = await rollupFor(userId, days);
  const targets = targetsFor(user);
  const age = ageOf(user);
  const flags = flagsFor(rollup, targets, age);
  return { user, rollup, targets, age, flags, ruleScore: ruleScore(flags) };
}

export async function generateReport(userId: string, days = 14) {
  if (!aiEnabled()) throw new HttpError(503, "AI reports are not configured. Add ANTHROPIC_API_KEY to server/.env.");
  const ctx = await healthContext(userId, days);
  const { user } = ctx;
  if (ctx.rollup.daysLogged < 3) throw new HttpError(400, "Log at least 3 days of meals before generating a report.");

  const stock = await stockByFood(user.householdId);
  const foods = await prisma.foodItem.findMany({ where: { id: { in: [...stock.keys()] } }, select: { name: true } });

  const payload = {
    member: {
      name: user.name, age: ctx.age, sex: user.sex, heightCm: user.heightCm, weightKg: user.weightKg,
      activityLevel: user.activityLevel, goals: user.dietaryGoals, allergies: user.allergies, dietType: user.dietType,
    },
    periodDays: days,
    dailyAverages: ctx.rollup.perDay,
    estimatedDailyTargets: ctx.targets,
    weekly: {
      alcoholUnits: ctx.rollup.alcoholUnitsPerWeek,
      lateNightSnacks: ctx.rollup.lateNightSnacksPerWeek,
      mealsEatenOut: ctx.rollup.mealsEatenOutPerWeek,
      breakfastsSkipped: ctx.rollup.breakfastsSkippedPerWeek,
    },
    mostEaten: ctx.rollup.topFoods,
    biggestSugarSources: ctx.rollup.topSugarSources,
    ruleBasedFlags: ctx.flags,
    favourites: user.favourites.map((f) => f.recipe?.name ?? f.foodItem?.name).filter(Boolean),
    inFridgeNow: foods.map((f) => f.name),
  };

  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL(),
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
      // Server-side refusal fallback: if a safety classifier declines, the API retries on a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `Here is the data for ${user.name}. Write their health report.\n\n${JSON.stringify(payload, null, 2)}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The Anthropic API key was rejected.");
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, "AI is busy right now — try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI request failed (${err.status ?? "network"}).`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "The AI declined to write this report.");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new HttpError(502, "The AI response was incomplete — please try again.");

  const report = response.parsed_output;
  const now = new Date();
  return prisma.healthReport.create({
    data: {
      userId,
      periodStart: new Date(now.getTime() - days * 86_400_000),
      periodEnd: now,
      score: report.score,
      summary: report.summary,
      recommendations: JSON.stringify(report),
      model: response.model,
    },
  });
}
