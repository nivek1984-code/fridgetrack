import cookieParser from "cookie-parser";
import express from "express";
import { errorHandler } from "./middleware/error.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { householdRouter } from "./routes/household.js";
import { inventoryRouter } from "./routes/inventory.js";
import { mealsRouter } from "./routes/meals.js";
import { planningRouter } from "./routes/planning.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/status", (_req, res) => { res.json({ ok: true }); });
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth, householdRouter, inventoryRouter, mealsRouter, planningRouter);
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found" }); });

  app.use(errorHandler);
  return app;
}
