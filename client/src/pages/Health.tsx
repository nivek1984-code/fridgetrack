import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type HealthDetail, type HealthOverview } from "../api";
import { useMe } from "../auth";
import { Badge, ErrorBox, Loading, Meter, Spinner } from "../components/ui";
import { useStockMutation } from "../hooks";
import { ScorePill } from "./Dashboard";

export function Health() {
  const me = useMe();
  const { userId = me.id } = useParams();
  const nav = useNavigate();
  const overview = useQuery({ queryKey: ["health", "overview"], queryFn: () => api<HealthOverview[]>("/health"), enabled: me.role === "ADMIN" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Health & habits</h1>
        {me.role === "ADMIN" && overview.data && (
          <div className="flex flex-wrap gap-1">
            {overview.data.map((m) => (
              <button key={m.id} onClick={() => nav(`/health/${m.id}`)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${m.id === userId ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "border-stone-300 dark:border-stone-700"}`}>
                {m.name} <ScorePill score={m.aiScore ?? m.ruleScore} />
              </button>
            ))}
          </div>
        )}
      </div>
      <MemberHealth key={userId} userId={userId} />
      <p className="muted text-xs">Guidance is based on general public-health reference values and what's been logged. It isn't medical advice.</p>
    </div>
  );
}

function MemberHealth({ userId }: { userId: string }) {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["health", userId, days], queryFn: () => api<HealthDetail>(`/health/${userId}?days=${days}`) });
  const generate = useStockMutation(() => api(`/health/${userId}/report`, { body: { days } }));

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const h = q.data!;
  const p = h.rollup.perDay;
  const t = h.targets;
  const report = h.report?.recommendations;

  const rows: { label: string; value: string; v: number; target: number; invert?: boolean; note: string }[] = [
    { label: "Energy", value: `${Math.round(p.kcal)} kcal`, v: p.kcal, target: t.kcal, note: `~${t.kcal} estimated need` },
    { label: "Sugar", value: `${Math.round(p.sugarG)} g`, v: p.sugarG, target: t.sugarG, note: `${t.sugarG} g reference` },
    { label: "Fruit & veg", value: `${(p.fruitVegG / 80).toFixed(1)} portions`, v: p.fruitVegG, target: t.fruitVegG, invert: true, note: "aim for 5" },
    { label: "Fibre", value: `${Math.round(p.fibreG)} g`, v: p.fibreG, target: t.fibreG, invert: true, note: `aim for ${t.fibreG} g` },
    { label: "Protein", value: `${Math.round(p.proteinG)} g`, v: p.proteinG, target: t.proteinG, invert: true, note: `~${t.proteinG} g target` },
    { label: "Saturated fat", value: `${Math.round(p.satFatG)} g`, v: p.satFatG, target: t.satFatG, note: `under ${t.satFatG} g` },
    { label: "Salt", value: `${((p.sodiumMg * 2.5) / 1000).toFixed(1)} g`, v: p.sodiumMg, target: t.sodiumMg, note: `under ${((t.sodiumMg * 2.5) / 1000).toFixed(0)} g` },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{h.member.name}</h2>
              <p className="muted">Age {h.member.age} · {h.rollup.daysLogged} of {h.rollup.days} days logged</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums">{h.ruleScore}<span className="muted text-base">/10</span></div>
              <div className="muted text-xs">habit score</div>
            </div>
          </div>
          <div className="mt-3 flex gap-1">
            {[7, 14, 30].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-md px-2 py-1 text-xs ${days === d ? "bg-emerald-600 text-white" : "bg-stone-100 dark:bg-stone-800"}`}>{d} days</button>)}
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Daily averages</h2>
          {rows.map((r) => (
            <div key={r.label}>
              <div className="mb-1 flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums"><span className="font-medium">{r.value}</span> <span className="muted text-xs">· {r.note}</span></span></div>
              <Meter value={r.v} target={r.target} invert={r.invert} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
            <div><span className="muted text-xs">Sugary drinks</span><div>{Math.round(p.sugaryDrinksMl)} ml/day</div></div>
            <div><span className="muted text-xs">Late-night snacks</span><div>{h.rollup.lateNightSnacksPerWeek}/week</div></div>
            <div><span className="muted text-xs">Eaten out</span><div>{h.rollup.mealsEatenOutPerWeek}/week</div></div>
            {h.member.age >= 18 && <div><span className="muted text-xs">Alcohol</span><div>{h.rollup.alcoholUnitsPerWeek} units/week</div></div>}
          </div>
        </div>

        <div className="card">
          <h2 className="h2 mb-2">Biggest sugar sources</h2>
          <ul className="space-y-1 text-sm">
            {h.rollup.topSugarSources.map((s) => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="muted tabular-nums">{s.sugarG} g/day</span></li>)}
          </ul>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-3">
        <div className="card">
          <h2 className="h2 mb-3">What stands out</h2>
          <ul className="space-y-2">
            {h.flags.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span aria-hidden>{f.level === "good" ? "✅" : f.level === "warn" ? "⚠️" : "🔴"}</span>
                <span><span className="font-medium">{f.area}:</span> {f.message}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">✨ AI coach</h2>
            {h.aiEnabled && (
              <button className="btn-primary" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
                {generate.isPending ? <><Spinner className="h-4 w-4 border-white border-t-transparent" /> Thinking…</> : report ? "Refresh report" : "Get personalised advice"}
              </button>
            )}
          </div>
          <ErrorBox error={generate.error} />
          {!h.aiEnabled && !report && (
            <p className="muted">AI advice is turned off. Add an <code>ANTHROPIC_API_KEY</code> to <code>server/.env</code> and restart the server to get personalised reports from Claude.</p>
          )}
          {h.aiEnabled && !report && !generate.isPending && <p className="muted">Claude will review {h.member.name}'s last {days} days, goals and what's in the fridge, then suggest realistic swaps.</p>}
          {report && (
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <ScorePill score={report.score} />
                <p>{report.summary}</p>
              </div>
              {report.strengths.length > 0 && (
                <div><div className="mb-1 font-medium">Doing well</div><ul className="list-inside list-disc space-y-0.5">{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
              )}
              {report.concerns.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">Worth working on</div>
                  <ul className="space-y-2">
                    {report.concerns.map((c, i) => (
                      <li key={i}><Badge tone={c.severity === "high" ? "red" : c.severity === "medium" ? "amber" : "gray"}>{c.severity}</Badge> <span className="font-medium">{c.issue}</span> — <span className="muted">{c.why}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {report.swaps.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">Easy swaps</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {report.swaps.map((s, i) => (
                      <div key={i} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800/60">
                        <div><span className="text-stone-400 line-through">{s.instead}</span> → <span className="font-medium text-emerald-700 dark:text-emerald-400">{s.try}</span></div>
                        <div className="muted mt-1 text-xs">{s.why}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {report.shoppingSuggestions.length > 0 && <ShoppingSuggestions items={report.shoppingSuggestions} />}
              <p className="italic">{report.encouragement}</p>
              <p className="muted text-xs">Generated {new Date(h.report!.createdAt).toLocaleString()} by {h.report!.model}</p>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="h2 mb-2">Most eaten</h2>
          <div className="flex flex-wrap gap-1.5">{h.rollup.topFoods.map((f) => <Badge key={f.name}>{f.name} ×{f.times}</Badge>)}</div>
          <Link to="/log" className="mt-3 inline-block text-sm text-emerald-600">Open eating log →</Link>
        </div>
      </div>
    </div>
  );
}

function ShoppingSuggestions({ items }: { items: { name: string; reason: string }[] }) {
  const [added, setAdded] = useState<string[]>([]);
  const add = useStockMutation((name: string) => api("/shopping", { body: { name, quantity: 1 } }).then(() => setAdded((a) => [...a, name])));
  return (
    <div>
      <div className="mb-1 font-medium">Add to the shopping list?</div>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-2">
            <span><span className="font-medium">{s.name}</span> <span className="muted">— {s.reason}</span></span>
            <button className="btn-outline px-2 py-0.5 text-xs" disabled={added.includes(s.name) || add.isPending} onClick={() => add.mutate(s.name)}>{added.includes(s.name) ? "Added ✓" : "+ Add"}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
