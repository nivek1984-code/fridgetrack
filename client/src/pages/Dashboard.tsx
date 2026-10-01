import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type GroceryTrip, type HealthOverview, type InventoryBatch, type MealPlanEntry, type Predictions, type WasteInsights } from "../api";
import { useMe } from "../auth";
import { Badge, ErrorBox, Loading, Stat, expiryTone } from "../components/ui";
import { fmtDay, fmtQty, relDays, titleCase, todayISO } from "../format";

export function Dashboard() {
  const me = useMe();
  const predictions = useQuery({ queryKey: ["predictions"], queryFn: () => api<Predictions>("/predictions") });
  const inventory = useQuery({ queryKey: ["inventory"], queryFn: () => api<InventoryBatch[]>("/inventory") });
  const plan = useQuery({ queryKey: ["mealplan", "today"], queryFn: () => api<MealPlanEntry[]>(`/mealplan?from=${todayISO()}&to=${todayISO()}`) });
  const health = useQuery({ queryKey: ["health", "overview"], queryFn: () => api<HealthOverview[]>("/health") });
  const waste = useQuery({ queryKey: ["waste"], queryFn: () => api<WasteInsights>("/insights/waste") });

  if (predictions.isLoading || inventory.isLoading) return <Loading />;
  if (predictions.error || inventory.error) return <ErrorBox error={predictions.error ?? inventory.error} />;
  const { forecasts, proposal } = predictions.data!;
  const batches = inventory.data!;

  const expired = batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry < 0);
  const expiring = batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry >= 0 && b.daysToExpiry <= 2);
  const runningOut = forecasts.filter((f) => f.daysLeft !== null && f.daysLeft <= 3 && f.dailyRate > 0).slice(0, 8);
  const thisMonth = waste.data?.monthly.at(-1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Hi {me.name} 👋</h1>
        <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Items in stock" value={new Set(batches.map((b) => b.foodItemId)).size} sub={`${batches.length} packs`} />
        <Stat label="Past their date" value={expired.length} tone={expired.length ? "red" : "green"} sub="check & bin" />
        <Stat label="Expiring in 2 days" value={expiring.length} tone={expiring.length ? "amber" : "green"} sub="use these first" />
        <Stat label={thisMonth ? `Wasted in ${fmtDay(`${thisMonth.month}-01`, { month: "long" })}` : "Wasted"} value={thisMonth ? `$${thisMonth.wasted.toFixed(0)}` : "—"} sub={thisMonth ? `of $${thisMonth.spent.toFixed(0)} spent` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {proposal.topUp && <TripCard trip={proposal.topUp} kind="topUp" />}
          <TripCard trip={proposal} kind="main" />
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="mb-3 flex items-center justify-between"><h2 className="h2">Today's meals</h2><Link to="/meals" className="text-sm text-emerald-600">Meal plan →</Link></div>
            {plan.data?.length ? (
              <ul className="space-y-2">
                {plan.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <span><span className="muted mr-2 text-xs">{titleCase(m.mealType)}</span>{m.recipe.name}</span>
                    {m.cookedAt ? <Badge tone="green">Cooked</Badge> : <Badge>Planned</Badge>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nothing planned today.</p>}
          </div>

          <div className="card">
            <h2 className="h2 mb-3">Running out soon</h2>
            {runningOut.length ? (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {runningOut.map((f) => {
                  const usable = f.currentStock - f.expiredStock;
                  const out = usable <= 0;
                  return (
                    <li key={f.foodItemId} className="flex items-center justify-between py-2 text-sm">
                      <Link to={`/items/${f.foodItemId}`} className="hover:underline">{f.name}</Link>
                      <span className="flex items-center gap-2">
                        <span className="muted text-xs">{out ? (f.expiredStock > 0 ? "only past-date left" : "none left") : `${fmtQty(usable, f.unit)} left`}</span>
                        <Badge tone={out ? "red" : "amber"}>{out ? "out" : f.daysLeft! <= 0 ? "runs out today" : relDays(f.daysLeft)}</Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="muted">Nothing is about to run out.</p>}
          </div>

          {(expired.length > 0 || expiring.length > 0) && (
            <div className="card">
              <div className="mb-3 flex items-center justify-between"><h2 className="h2">Use it or lose it</h2><Link to="/fridge" className="text-sm text-emerald-600">Fridge →</Link></div>
              <ul className="space-y-1.5 text-sm">
                {[...expired, ...expiring].slice(0, 8).map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span>{b.foodItem.name} <span className="muted text-xs">{fmtQty(b.remainingQuantity, b.unit)}</span></span>
                    <Badge tone={expiryTone(b.daysToExpiry)}>{b.daysToExpiry! < 0 ? `${-b.daysToExpiry!}d past date` : `expires ${relDays(b.daysToExpiry)}`}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {health.data && health.data.length > 0 && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between"><h2 className="h2">Family health snapshot <span className="muted font-normal">· last 14 days</span></h2><Link to="/health" className="text-sm text-emerald-600">Details →</Link></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {health.data.map((m) => (
              <Link to={`/health/${m.id}`} key={m.id} className="rounded-xl border border-stone-200 p-3 hover:border-emerald-400 dark:border-stone-800">
                <div className="flex items-center justify-between"><span className="font-medium">{m.name}</span><ScorePill score={m.aiScore ?? m.ruleScore} /></div>
                <p className="muted mt-1 line-clamp-2 text-xs">{m.topConcern?.message ?? "Looking good."}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {waste.data && waste.data.monthly.length > 1 && (
        <div className="card">
          <h2 className="h2 mb-3">Grocery spend vs waste</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waste.data.monthly.map((m) => ({ ...m, label: fmtDay(`${m.month}-01`, { month: "short" }) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `$${v}`} width={48} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend />
                <Bar dataKey="spent" name="Spent" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="wasted" name="Wasted" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {waste.data.topWasted.length > 0 && <p className="muted mt-2 text-xs">Most wasted: {waste.data.topWasted.slice(0, 4).map((w) => `${w.name} ($${w.value.toFixed(0)})`).join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 8 ? "green" : score >= 6 ? "amber" : "red";
  return <Badge tone={tone}>{score}/10</Badge>;
}

function TripCard({ trip, kind }: { trip: GroceryTrip; kind: "main" | "topUp" }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api<{ added: number }>("/shopping/from-proposal", { body: { trip: kind } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
  });
  const isToday = trip.date === todayISO();
  return (
    <div className={`card ${kind === "topUp" ? "border-amber-300 dark:border-amber-800" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="muted text-xs font-medium uppercase tracking-wide">{kind === "topUp" ? "Quick top-up" : "Next grocery run"}</div>
          <h2 className="mt-0.5 text-lg font-semibold">{isToday ? "Today" : fmtDay(trip.date, { weekday: "long", day: "numeric", month: "short" })}</h2>
          <p className="muted">{trip.reason}</p>
        </div>
        {trip.urgent && <Badge tone={kind === "topUp" ? "amber" : "red"}>Soon</Badge>}
      </div>
      {trip.items.length > 0 ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {trip.items.slice(0, kind === "topUp" ? 20 : 14).map((i) => (
              <li key={i.foodItemId} title={i.why}><Badge tone={i.why === "Needed for planned meals" ? "blue" : "gray"}>{i.name}{i.packs > 1 ? ` ×${i.packs}` : ""}</Badge></li>
            ))}
            {trip.items.length > 14 && kind === "main" && <li><Badge>+{trip.items.length - 14} more</Badge></li>}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-primary" onClick={() => add.mutate()} disabled={add.isPending}>Add {trip.items.length} to shopping list</button>
            {add.data && <span className="muted text-xs">{add.data.added ? `Added ${add.data.added}` : "Already on the list"} · <Link to="/shopping" className="text-emerald-600">view</Link></span>}
          </div>
          <ErrorBox error={add.error} />
        </>
      ) : <p className="muted mt-2">Nothing needed.</p>}
    </div>
  );
}
