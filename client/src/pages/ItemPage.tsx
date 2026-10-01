import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ItemDetail, type Predictions } from "../api";
import { Badge, ErrorBox, Loading, Stat } from "../components/ui";
import { CATEGORY_EMOJI, fmtDay, fmtQty, relDays, titleCase } from "../format";
import { useStockMutation } from "../hooks";

const EVENT_LABEL: Record<string, { label: string; tone: "green" | "gray" | "red" | "blue" }> = {
  ADDED: { label: "Bought", tone: "green" }, CONSUMED: { label: "Used", tone: "gray" }, DISCARDED: { label: "Binned", tone: "red" }, ADJUSTED: { label: "Adjusted", tone: "blue" },
};

export function ItemPage() {
  const { id } = useParams();
  const detail = useQuery({ queryKey: ["item", id], queryFn: () => api<ItemDetail>(`/items/${id}?days=60`) });
  const predictions = useQuery({ queryKey: ["predictions"], queryFn: () => api<Predictions>("/predictions") });
  const addShop = useStockMutation(() => api("/shopping", { body: { foodItemId: id, quantity: detail.data!.item.unitSize } }));

  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const { item, series, stats, events, batches } = detail.data!;
  const fc = predictions.data?.forecasts.find((f) => f.foodItemId === id);
  const stock = batches.reduce((s, b) => s + b.remainingQuantity, 0);

  return (
    <div className="space-y-5">
      <Link to="/fridge" className="muted hover:underline">← Fridge</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{CATEGORY_EMOJI[item.category]} {item.name}</h1>
        <div className="flex items-center gap-2">
          {item.isStaple && <Badge tone="blue">Staple</Badge>}
          <Badge>{titleCase(item.category)}</Badge>
          <button className="btn-outline" onClick={() => addShop.mutate(undefined)} disabled={addShop.isPending || addShop.isSuccess}>{addShop.isSuccess ? "On the list ✓" : "+ Shopping list"}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In stock" value={fmtQty(stock, item.defaultUnit)} sub={`${batches.length} pack${batches.length === 1 ? "" : "s"}`} />
        <Stat label="Predicted to run out" value={fc ? (fc.daysLeft === null ? "2+ weeks" : fc.daysLeft <= 0 ? "Now" : relDays(fc.daysLeft)) : "—"}
          tone={fc?.daysLeft != null && fc.daysLeft <= 2 ? "amber" : undefined}
          sub={fc ? `${Math.round(fc.confidence * 100)}% confidence · ${fc.source === "BLEND" ? "habits + meal plan" : fc.source === "MEAL_PLAN" ? "meal plan" : "habits"}` : undefined} />
        <Stat label="Used per day" value={fmtQty(stats.consumedPerDay, item.defaultUnit)} sub={`last ${stats.days} days`} />
        <Stat label="Wasted" value={`${stats.wastePct}%`} tone={stats.wastePct > 25 ? "red" : stats.wastePct > 10 ? "amber" : "green"} sub={`${fmtQty(stats.wasted, item.defaultUnit)} binned`} />
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Stock over the last {stats.days} days</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
              <XAxis dataKey="date" tickFormatter={(d) => fmtDay(d, { day: "numeric", month: "short" })} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
              <Tooltip labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => fmtQty(Number(v), item.defaultUnit)} />
              <Area type="stepAfter" dataKey="stock" name="In stock" stroke="#10b981" fill="url(#g)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-3">Daily use</h2>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series.slice(-28)}>
                <XAxis dataKey="date" tickFormatter={(d) => fmtDay(d, { day: "numeric" })} tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                <Tooltip labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => fmtQty(Number(v), item.defaultUnit)} />
                <Bar dataKey="consumed" name="Used" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                <Bar dataKey="discarded" name="Binned" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {stats.byMember.length > 0 && <p className="muted mt-2 text-xs">Who uses it: {stats.byMember.map((m) => `${m.name} ${fmtQty(m.qty, item.defaultUnit)}`).join(" · ")}</p>}
        </div>

        <div className="card">
          <h2 className="h2 mb-3">History</h2>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Badge tone={EVENT_LABEL[e.type]?.tone}>{EVENT_LABEL[e.type]?.label ?? e.type}</Badge>{fmtQty(Math.abs(e.quantityDelta), item.defaultUnit)}{e.user && <span className="muted text-xs">by {e.user}</span>}</span>
                <span className="muted text-xs">{new Date(e.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {item.kcal != null && (
        <div className="card text-sm">
          <h2 className="h2 mb-2">Nutrition per {item.defaultUnit === "pcs" ? "piece" : `100 ${item.defaultUnit}`}</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>{Math.round(item.kcal)} kcal</span><span>Protein {item.proteinG} g</span><span>Sugar {item.sugarG} g</span>
            <span>Sat. fat {item.satFatG} g</span><span>Fibre {item.fibreG} g</span><span>Sodium {item.sodiumMg} mg</span>
            {item.allergens && <Badge tone="red">Contains {item.allergens}</Badge>}
          </div>
        </div>
      )}
    </div>
  );
}
