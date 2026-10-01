# FridgeTrack

A family grocery & fridge tracker: tracks what's in the fridge (current + full history), lets each family member log eating habits and favourites, predicts when ingredients will run out from recipes/meal plans, proposes grocery runs, and uses Claude to reason about each member's eating habits.

**Stack:** React (client, coming next) · Node.js + Express + TypeScript (server) · SQLite via Prisma · Claude API

## Status
Step 1 — data layer and realistic demo data — is done. Auth, API and React UI are next.

## Quick start
```bash
npm install
cp server/.env.example server/.env
cd server && npx prisma migrate dev && cd ..   # creates SQLite DB and seeds it
npm run data:report                            # summary of the demo data
npm test
```

## Demo data
`server/prisma/generate.ts` is a deterministic simulator that produces ~120 days of household history: weekly grocery runs and top-ups, meal plans, cooking, snacking, freezing and spoilage — all consistent (stock never goes negative).

| Command | What it does |
|---|---|
| `npm run generate` | Rebuild `server/prisma/data/generated/*.json` (options: `-- --seed 7 --end 2026-10-01 --days 120`) |
| `npm run seed` | Wipe and reload the database |
| `npm run data:report` | Print fridge contents, per-member nutrition, waste, upcoming meals |
| `npx prisma studio` (in `server/`) | Browse the tables |

Demo logins (password `demo1234`): `alex@demo.family`, `sam@demo.family`, `jordan@demo.family`, `mia@demo.family`.

Edit `server/prisma/data/household.json`, `foodCatalog.json` and `recipes.json` to model your own family.
