# FridgeTrack

A family grocery & fridge tracker: tracks what's in the fridge (current + full history), lets each family member log eating habits and favourites, predicts when ingredients will run out from habits and the meal plan, proposes grocery runs, and uses Claude to give each member personalised eating-habit advice.

**Stack:** React + Vite + Tailwind (client) · Node.js + Express + TypeScript (server) · SQLite via Prisma · Claude API

## Run it

```bash
npm install
cp server/.env.example server/.env          # first time only
cd server && npx prisma migrate dev && cd ..  # first time only: creates + seeds the SQLite DB
npm run dev
```

Open **http://localhost:5173** and sign in with a demo account (password `demo1234`):
`alex@demo.family` · `sam@demo.family` (parents/admins) · `jordan@demo.family` · `mia@demo.family`

The API runs on http://localhost:4000 (Vite proxies `/api` to it).

### AI health reports (optional)
Add `ANTHROPIC_API_KEY=sk-ant-...` to `server/.env` and restart. The Health page then shows a **Get personalised advice** button. Without a key, the rule-based scores and flags still work.

## Features
- **Dashboard** – stock overview, past-date and expiring items, what runs out soon, today's meals, family health snapshot, spend vs waste chart.
- **Grocery-run proposal** – your usual weekly shop (Saturday by default) plus a small *top-up* when a staple, favourite or planned-meal ingredient won't last until then. One click adds it to the shopping list.
- **Fridge / freezer / pantry** – current stock per item, oldest-first consumption, bin expired packs, add groceries (or new catalog items).
- **Item history** – stock-over-time chart, daily use, who uses it, waste %, run-out prediction with confidence.
- **Meal plan & recipes** – weekly planner, "can make now" filter, missing ingredients, nutrition per serving, allergy warnings. *Cook* takes the ingredients from stock and logs the meal for each eater (allergic members are left out automatically).
- **Eating log & favourites** – log foods, drinks, recipes or meals eaten out; optionally take them from the fridge.
- **Shopping list** – grouped by aisle; *Done shopping* puts ticked items into the fridge.
- **Health** – per-member daily averages vs age/goal-based targets, flags (sugar, fruit & veg, sugary drinks, late-night snacking, alcohol…), and Claude-written reports with swaps based on what's in the fridge.
- **Family** – profiles (age, activity, goals, allergies), invite code to join the household, grocery-day settings.

## Demo data
`server/prisma/generate.ts` simulates ~120 days of household life (grocery runs, meal plans, cooking, snacking, freezing, spoilage) ending today, so predictions and health insights have realistic data from day one.

| Command | What it does |
|---|---|
| `npm run generate` | Rebuild `server/prisma/data/generated/*.json` (options: `-- --seed 7 --end 2026-10-01 --days 120`) |
| `npm run seed` | Wipe and reload the database (run `generate` first to move the demo up to today) |
| `npm run data:report` | Print fridge contents, per-member nutrition, waste, upcoming meals |
| `npm test` | Data-generator tests |

Edit `server/prisma/data/household.json`, `foodCatalog.json` and `recipes.json` to model your own family.

*Health guidance uses general public-health reference values and is not medical advice.*
