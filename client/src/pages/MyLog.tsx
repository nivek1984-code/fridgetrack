import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type EatingLog, type Favourite, type LogType } from "../api";
import { useMe } from "../auth";
import { Badge, Empty, ErrorBox, Loading, Modal } from "../components/ui";
import { fmtDay, fmtQty, fmtTime, titleCase } from "../format";
import { useCatalog, useHousehold, useRecipes, useStockMutation } from "../hooks";

const TYPES: LogType[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "DRINK"];

export function MyLog() {
  const me = useMe();
  const household = useHousehold();
  const [userId, setUserId] = useState(me.id);
  const logs = useQuery({ queryKey: ["logs", userId], queryFn: () => api<EatingLog[]>(`/logs?userId=${userId}&days=7`) });
  const [adding, setAdding] = useState(false);
  const remove = useStockMutation((id: string) => api(`/logs/${id}`, { method: "DELETE" }));
  const members = me.role === "ADMIN" ? household.data?.users ?? [] : [];
  const who = household.data?.users.find((u) => u.id === userId);

  const byDay = new Map<string, EatingLog[]>();
  for (const l of logs.data ?? []) {
    const d = new Date(l.date).toLocaleDateString("en-CA");
    byDay.set(d, [...(byDay.get(d) ?? []), l]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{userId === me.id ? "My eating log" : `${who?.name ?? ""}'s eating log`}</h1>
        <div className="flex items-center gap-2">
          {members.length > 1 && (
            <select className="input w-auto" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Family member">
              {members.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (me)` : u.name}</option>)}
            </select>
          )}
          <button className="btn-primary" onClick={() => setAdding(true)}>+ Log food</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <ErrorBox error={logs.error ?? remove.error} />
          {logs.isLoading ? <Loading /> : byDay.size === 0 ? <Empty title="Nothing logged this week">Log meals, snacks and drinks so the app can learn your habits.</Empty> : (
            [...byDay].map(([day, items]) => {
              const kcal = items.reduce((s, l) => s + (l.kcal ?? 0), 0);
              const sugar = items.reduce((s, l) => s + (l.sugarG ?? 0), 0);
              return (
                <div key={day} className="card">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{fmtDay(day, { weekday: "long", day: "numeric", month: "short" })}</span>
                    <span className="muted text-xs">{Math.round(kcal)} kcal · {Math.round(sugar)} g sugar</span>
                  </div>
                  <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
                    {[...items].sort((a, b) => a.date.localeCompare(b.date)).map((l) => (
                      <li key={l.id} className="group flex items-center justify-between gap-2 py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="muted w-16 shrink-0 whitespace-nowrap text-xs tabular-nums">{fmtTime(l.date)}</span>
                          <Badge tone={l.mealType === "DRINK" ? "blue" : l.mealType === "SNACK" ? "amber" : "gray"}>{titleCase(l.mealType)}</Badge>
                          <span className="truncate">
                            {l.recipe?.name ?? l.foodItem?.name ?? l.freeText}
                            {l.foodItem && l.quantity ? <span className="muted text-xs"> · {fmtQty(l.quantity, l.foodItem.defaultUnit)}</span> : null}
                            {l.recipe && l.freeText ? <span className="muted text-xs"> · {l.freeText}</span> : null}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="muted text-xs tabular-nums">{l.kcal ?? "?"} kcal</span>
                          <button className="btn-danger invisible px-1 py-0 text-xs group-hover:visible" onClick={() => remove.mutate(l.id)} aria-label="Delete entry">✕</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
        <FavouritesCard userId={userId} />
      </div>
      {adding && <AddLogModal userId={userId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function FavouritesCard({ userId }: { userId: string }) {
  const me = useMe();
  const favs = useQuery({ queryKey: ["favourites"], queryFn: () => api<Favourite[]>("/favourites") });
  const catalog = useCatalog();
  const recipes = useRecipes();
  const [pick, setPick] = useState("");
  const mine = (favs.data ?? []).filter((f) => f.userId === userId);
  const add = useStockMutation(async () => {
    const [kind, id] = pick.split(":");
    await api("/favourites", { body: kind === "r" ? { recipeId: id } : { foodItemId: id } });
    setPick("");
    await favs.refetch();
  });
  const remove = useStockMutation(async (id: string) => { await api(`/favourites/${id}`, { method: "DELETE" }); await favs.refetch(); });
  const editable = userId === me.id;
  return (
    <div className="card h-fit">
      <h2 className="h2 mb-3">♥ Favourites</h2>
      {mine.length === 0 ? <p className="muted">No favourites yet.</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {mine.map((f) => (
            <li key={f.id}>
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {f.recipe ? "🍽️" : "🛒"} {f.recipe?.name ?? f.foodItem?.name}
                {editable && <button onClick={() => remove.mutate(f.id)} aria-label="Remove favourite" className="ml-0.5 opacity-60 hover:opacity-100">✕</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pick) add.mutate(undefined); }}>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add favourite">
            <option value="">Add a favourite…</option>
            <optgroup label="Recipes">{recipes.data?.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}</optgroup>
            <optgroup label="Foods & drinks">{catalog.data?.map((c) => <option key={c.id} value={`f:${c.id}`}>{c.name}</option>)}</optgroup>
          </select>
          <button className="btn-outline" disabled={!pick || add.isPending}>Add</button>
        </form>
      )}
      <p className="muted mt-3 text-xs">Favourites get priority in grocery proposals and meal suggestions.</p>
    </div>
  );
}

function AddLogModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const catalog = useCatalog();
  const recipes = useRecipes();
  const hour = new Date().getHours();
  const [mode, setMode] = useState<"food" | "recipe" | "other">("food");
  const [f, setF] = useState({
    mealType: (hour < 11 ? "BREAKFAST" : hour < 15 ? "LUNCH" : hour < 18 ? "SNACK" : "DINNER") as LogType,
    foodItemId: "", recipeId: "", quantity: "" as number | "", freeText: "", kcal: "" as number | "", takeFromFridge: true,
    time: new Date().toTimeString().slice(0, 5),
  });
  const food = catalog.data?.find((c) => c.id === f.foodItemId);
  const save = useStockMutation(() => {
    const date = new Date(); const [h, m] = f.time.split(":").map(Number); date.setHours(h, m, 0, 0);
    return api("/logs", {
      body: {
        userId, date: date.toISOString(), mealType: f.mealType,
        ...(mode === "food" ? { foodItemId: f.foodItemId, quantity: f.quantity === "" ? undefined : f.quantity, takeFromFridge: f.takeFromFridge } : {}),
        ...(mode === "recipe" ? { recipeId: f.recipeId, quantity: f.quantity === "" ? 1 : f.quantity, takeFromFridge: f.takeFromFridge } : {}),
        ...(mode === "other" ? { freeText: f.freeText, kcal: f.kcal === "" ? null : f.kcal } : {}),
      },
    });
  }, onClose);

  return (
    <Modal open onClose={onClose} title="Log food or drink">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 text-sm dark:bg-stone-800">
          {([["food", "Food / drink"], ["recipe", "Recipe"], ["other", "Ate out"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md py-1.5 font-medium ${mode === m ? "bg-white shadow-sm dark:bg-stone-900" : "text-stone-500"}`}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="lt">Meal</label><select id="lt" className="input" value={f.mealType} onChange={(e) => setF({ ...f, mealType: e.target.value as LogType })}>{TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select></div>
          <div><label className="label" htmlFor="tm">Time (today)</label><input id="tm" className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
        </div>
        {mode === "food" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="label" htmlFor="fi">Food or drink</label>
              <select id="fi" className="input" value={f.foodItemId} onChange={(e) => setF({ ...f, foodItemId: e.target.value })} required>
                <option value="">Choose…</option>{catalog.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.stock > 0 ? "" : " (none in stock)"}</option>)}
              </select></div>
            <div><label className="label" htmlFor="q">Amount{food ? ` (${food.defaultUnit})` : ""}</label><input id="q" className="input" type="number" min={0.1} step="any" value={f.quantity} placeholder={food ? String(food.defaultUnit === "pcs" ? 1 : food.isDrink ? 250 : 100) : ""} onChange={(e) => setF({ ...f, quantity: e.target.value === "" ? "" : Number(e.target.value) })} required /></div>
          </div>
        )}
        {mode === "recipe" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="label" htmlFor="rc">Recipe</label>
              <select id="rc" className="input" value={f.recipeId} onChange={(e) => setF({ ...f, recipeId: e.target.value })} required>
                <option value="">Choose…</option>{recipes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
            <div><label className="label" htmlFor="sv">Servings</label><input id="sv" className="input" type="number" min={0.25} step={0.25} value={f.quantity === "" ? 1 : f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></div>
          </div>
        )}
        {mode === "other" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="label" htmlFor="ft">What did you have?</label><input id="ft" className="input" placeholder="e.g. Burger and fries" value={f.freeText} onChange={(e) => setF({ ...f, freeText: e.target.value })} required /></div>
            <div><label className="label" htmlFor="kc">kcal (estimate)</label><input id="kc" className="input" type="number" min={0} value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value === "" ? "" : Number(e.target.value) })} /></div>
          </div>
        )}
        {mode !== "other" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.takeFromFridge} onChange={(e) => setF({ ...f, takeFromFridge: e.target.checked })} /> It came from our fridge — update stock</label>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}
