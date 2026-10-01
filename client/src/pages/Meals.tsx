import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Favourite, type MealPlanEntry, type MealType, type Member, type Recipe } from "../api";
import { useMe } from "../auth";
import { Badge, Empty, ErrorBox, Loading, Modal, Tabs } from "../components/ui";
import { addDaysISO, fmtDay, fmtQty, titleCase, todayISO } from "../format";
import { useCatalog, useHousehold, useRecipes, useStockMutation } from "../hooks";

const MEALS: MealType[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];

export function Meals() {
  const [tab, setTab] = useState<"plan" | "recipes">("plan");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Meals</h1>
        <Tabs value={tab} onChange={setTab} options={[{ value: "plan", label: "Meal plan" }, { value: "recipes", label: "Recipes" }]} />
      </div>
      {tab === "plan" ? <PlanView /> : <RecipesView />}
    </div>
  );
}

function PlanView() {
  const [start, setStart] = useState(todayISO());
  const end = addDaysISO(start, 6);
  const plan = useQuery({ queryKey: ["mealplan", start], queryFn: () => api<MealPlanEntry[]>(`/mealplan?from=${start}&to=${end}`) });
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null);
  const [cooking, setCooking] = useState<MealPlanEntry | null>(null);
  const remove = useStockMutation((id: string) => api(`/mealplan/${id}`, { method: "DELETE" }));
  const recipes = useRecipes();
  const household = useHousehold();
  const allergyWarning = (recipeId: string) => {
    const who = allergicMembers(household.data?.users ?? [], recipes.data?.find((r) => r.id === recipeId));
    return who.length ? `Allergy: ${who.map((m) => m.name).join(", ")}` : null;
  };
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn-outline px-2" onClick={() => setStart(addDaysISO(start, -7))} aria-label="Previous week">←</button>
        <button className="btn-outline" onClick={() => setStart(todayISO())}>This week</button>
        <button className="btn-outline px-2" onClick={() => setStart(addDaysISO(start, 7))} aria-label="Next week">→</button>
        <span className="muted ml-2">{fmtDay(start, { day: "numeric", month: "short" })} – {fmtDay(end, { day: "numeric", month: "short" })}</span>
      </div>
      <ErrorBox error={plan.error ?? remove.error} />
      {plan.isLoading ? <Loading /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {days.map((d) => {
            const entries = (plan.data ?? []).filter((e) => e.date.slice(0, 10) === d);
            return (
              <div key={d} className={`card ${d === todayISO() ? "ring-2 ring-emerald-500/40" : ""}`}>
                <div className="mb-2 font-medium">{d === todayISO() ? "Today" : fmtDay(d, { weekday: "long", day: "numeric", month: "short" })}</div>
                <ul className="space-y-2">
                  {MEALS.map((mt) => {
                    const es = entries.filter((e) => e.mealType === mt);
                    if (!es.length && mt === "SNACK") return null;
                    return (
                      <li key={mt}>
                        <div className="muted text-[11px] font-medium uppercase tracking-wide">{titleCase(mt)}</div>
                        {es.map((e) => (
                          <div key={e.id} className="group flex items-center justify-between gap-2 text-sm">
                            <span className={e.cookedAt ? "text-stone-400 line-through decoration-stone-300" : ""}>
                              {e.recipe.name} <span className="muted text-xs">×{e.servings}</span>
                              {!e.cookedAt && allergyWarning(e.recipeId) && <span className="ml-1 cursor-help text-xs" title={allergyWarning(e.recipeId)!} aria-label={allergyWarning(e.recipeId)!}>⚠️</span>}
                            </span>
                            {e.cookedAt ? <Badge tone="green">Cooked</Badge> : (
                              <span className="flex shrink-0 gap-1">
                                <button className="btn-outline px-2 py-0.5 text-xs" onClick={() => setCooking(e)}>Cook</button>
                                <button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => remove.mutate(e.id)} aria-label={`Remove ${e.recipe.name}`}>✕</button>
                              </span>
                            )}
                          </div>
                        ))}
                        {!es.length && <button className="text-xs text-emerald-600 hover:underline" onClick={() => setAdding({ date: d, mealType: mt })}>+ add</button>}
                      </li>
                    );
                  })}
                </ul>
                <button className="mt-2 text-xs text-stone-500 hover:underline" onClick={() => setAdding({ date: d, mealType: "SNACK" })}>+ snack/dessert</button>
              </div>
            );
          })}
        </div>
      )}
      {adding && <AddToPlanModal initial={adding} onClose={() => setAdding(null)} />}
      {cooking && <CookModal entry={cooking} onClose={() => setCooking(null)} />}
    </div>
  );
}

function AddToPlanModal({ initial, onClose, recipe }: { initial: { date: string; mealType: MealType }; onClose: () => void; recipe?: Recipe }) {
  const recipes = useRecipes();
  const [f, setF] = useState({ date: initial.date, mealType: initial.mealType, recipeId: recipe?.id ?? "", servings: 4 });
  const add = useStockMutation(() => api("/mealplan", { body: f }), onClose);
  const options = (recipes.data ?? []).filter((r) => r.mealType === f.mealType || recipe);
  return (
    <Modal open onClose={onClose} title="Plan a meal">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="d">Day</label><input id="d" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></div>
          <div><label className="label" htmlFor="mt">Meal</label><select id="mt" className="input" value={f.mealType} onChange={(e) => setF({ ...f, mealType: e.target.value as MealType, recipeId: recipe?.id ?? "" })}>{MEALS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</select></div>
        </div>
        <div>
          <label className="label" htmlFor="r">Recipe</label>
          <select id="r" className="input" value={f.recipeId} onChange={(e) => setF({ ...f, recipeId: e.target.value })} required>
            <option value="">Choose…</option>
            {options.map((r) => <option key={r.id} value={r.id}>{r.name}{r.canMake ? " ✓ can make now" : ` (missing ${r.missing.length})`}{r.favouritedBy.length ? ` ♥ ${r.favouritedBy.join(", ")}` : ""}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="sv">Servings</label><input id="sv" className="input" type="number" min={1} max={20} value={f.servings} onChange={(e) => setF({ ...f, servings: Number(e.target.value) })} /></div>
        <ErrorBox error={add.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={add.isPending}>Add to plan</button></div>
      </form>
    </Modal>
  );
}

/** Members whose listed allergies overlap the recipe's allergens. */
function allergicMembers(members: Member[], recipe: Recipe | undefined) {
  if (!recipe?.allergens.length) return [];
  return members.filter((m) => m.allergies?.split(",").some((a) => recipe.allergens.includes(a.trim().toLowerCase())));
}

function CookModal({ entry, onClose }: { entry: MealPlanEntry; onClose: () => void }) {
  const household = useHousehold();
  const recipes = useRecipes();
  const [eaters, setEaters] = useState<string[] | null>(null);
  const all = household.data?.users ?? [];
  const recipe = recipes.data?.find((r) => r.id === entry.recipeId);
  const allergic = allergicMembers(all, recipe);
  const selected = eaters ?? all.filter((u) => !allergic.includes(u)).map((u) => u.id);
  const cook = useStockMutation(() => api<{ shortages: string[] }>(`/mealplan/${entry.id}/cook`, { body: { eaterIds: selected } }));
  const toggle = (id: string) => setEaters(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Modal open onClose={onClose} title={`Cook ${entry.recipe.name}`}>
      {cook.isSuccess ? (
        <div className="space-y-3">
          <p>Done! Ingredients were taken from the fridge and the meal was added to each eater's log.</p>
          {cook.data.shortages.length > 0 && <p className="text-sm text-amber-600">The fridge didn't have enough of: {cook.data.shortages.join(", ")}. Add them to the shopping list if you'll need more.</p>}
          <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="muted">This uses the ingredients for {entry.servings} servings from your stock. Who's eating?</p>
          {allergic.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              ⚠️ Contains {recipe!.allergens.join(", ")} — {allergic.map((m) => m.name).join(", ")} {allergic.length > 1 ? "are" : "is"} allergic and {allergic.length > 1 ? "have" : "has"} been left out.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {all.map((u) => (
              <button key={u.id} type="button" onClick={() => toggle(u.id)} className={`rounded-full border px-3 py-1 text-sm ${selected.includes(u.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "border-stone-300 dark:border-stone-700"}`}>{u.name}</button>
            ))}
          </div>
          <ErrorBox error={cook.error} />
          <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => cook.mutate(undefined)} disabled={cook.isPending}>Mark as cooked</button></div>
        </div>
      )}
    </Modal>
  );
}

function RecipesView() {
  const me = useMe();
  const recipes = useRecipes();
  const favs = useQuery({ queryKey: ["favourites"], queryFn: () => api<Favourite[]>("/favourites") });
  const [filter, setFilter] = useState<"ALL" | MealType | "CAN_MAKE">("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [planning, setPlanning] = useState<Recipe | null>(null);
  const [creating, setCreating] = useState(false);
  const myFavs = useMemo(() => new Map((favs.data ?? []).filter((f) => f.userId === me.id && f.recipe).map((f) => [f.recipe!.id, f.id])), [favs.data, me.id]);
  const toggleFav = useStockMutation(async (r: Recipe) => {
    const fid = myFavs.get(r.id);
    if (fid) await api(`/favourites/${fid}`, { method: "DELETE" });
    else await api("/favourites", { body: { recipeId: r.id } });
    await favs.refetch();
  });

  if (recipes.isLoading) return <Loading />;
  const list = (recipes.data ?? []).filter((r) => filter === "ALL" || (filter === "CAN_MAKE" ? r.canMake : r.mealType === filter));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", "CAN_MAKE", ...MEALS] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm ${filter === f ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "border-stone-300 dark:border-stone-700"}`}>
            {f === "ALL" ? "All" : f === "CAN_MAKE" ? "Can make now" : titleCase(f)}
          </button>
        ))}
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}>+ New recipe</button>
      </div>
      <ErrorBox error={recipes.error ?? toggleFav.error} />
      {list.length === 0 ? <Empty title="No recipes match" /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <div key={r.id} className="card flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <button className="text-left font-medium hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.name}</button>
                <button onClick={() => toggleFav.mutate(r)} className={`text-lg leading-none ${myFavs.has(r.id) ? "text-rose-500" : "text-stone-300 hover:text-rose-400"}`} aria-label={myFavs.has(r.id) ? "Remove favourite" : "Add favourite"}>♥</button>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge>{titleCase(r.mealType)}</Badge>
                {r.canMake ? <Badge tone="green">Can make now</Badge> : <Badge tone="amber">Missing {r.missing.length}</Badge>}
                {r.allergens.map((a) => <Badge key={a} tone="red">Contains {a}</Badge>)}
              </div>
              <div className="muted text-xs">{r.perServing.kcal} kcal · {r.perServing.sugarG} g sugar · {r.perServing.proteinG} g protein per serving{r.prepMinutes ? ` · ${r.prepMinutes} min` : ""}</div>
              {r.favouritedBy.length > 0 && <div className="text-xs text-rose-500">♥ {r.favouritedBy.join(", ")}</div>}
              {open === r.id && (
                <div className="space-y-2 border-t border-stone-100 pt-2 text-sm dark:border-stone-800">
                  <ul className="space-y-0.5">
                    {r.ingredients.map((i) => {
                      const miss = r.missing.find((m) => m.name === i.foodItem.name);
                      return <li key={i.id} className={miss ? "text-amber-600" : ""}>{fmtQty(i.quantity, i.unit)} {i.foodItem.name}{miss ? ` (have ${fmtQty(miss.have, i.unit)})` : ""}</li>;
                    })}
                  </ul>
                  {r.instructions && <p className="muted">{r.instructions}</p>}
                </div>
              )}
              <div className="mt-auto pt-1"><button className="btn-outline w-full" onClick={() => setPlanning(r)}>Add to meal plan</button></div>
            </div>
          ))}
        </div>
      )}
      {planning && <AddToPlanModal recipe={planning} initial={{ date: todayISO(), mealType: planning.mealType }} onClose={() => setPlanning(null)} />}
      {creating && <NewRecipeModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewRecipeModal({ onClose }: { onClose: () => void }) {
  const catalog = useCatalog();
  const [f, setF] = useState({ name: "", mealType: "DINNER" as MealType, servings: 4, prepMinutes: 30, instructions: "", tags: "" });
  const [ings, setIngs] = useState<{ foodItemId: string; quantity: number }[]>([{ foodItemId: "", quantity: 100 }]);
  const create = useStockMutation(() => api("/recipes", { body: { ...f, ingredients: ings.filter((i) => i.foodItemId) } }), onClose);
  const unitOf = (id: string) => catalog.data?.find((c) => c.id === id)?.defaultUnit ?? "";
  return (
    <Modal open onClose={onClose} title="New recipe">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
        <div><label className="label" htmlFor="rn">Name</label><input id="rn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label" htmlFor="rm">Meal</label><select id="rm" className="input" value={f.mealType} onChange={(e) => setF({ ...f, mealType: e.target.value as MealType })}>{MEALS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</select></div>
          <div><label className="label" htmlFor="rs">Servings</label><input id="rs" className="input" type="number" min={1} value={f.servings} onChange={(e) => setF({ ...f, servings: Number(e.target.value) })} /></div>
          <div><label className="label" htmlFor="rp">Minutes</label><input id="rp" className="input" type="number" min={0} value={f.prepMinutes} onChange={(e) => setF({ ...f, prepMinutes: Number(e.target.value) })} /></div>
        </div>
        <div>
          <div className="label">Ingredients</div>
          <div className="space-y-2">
            {ings.map((ing, i) => (
              <div key={i} className="flex gap-2">
                <select className="input" value={ing.foodItemId} onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, foodItemId: e.target.value } : x)))} aria-label="Ingredient">
                  <option value="">Choose…</option>
                  {catalog.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input className="input w-24" type="number" min={0.1} step="any" value={ing.quantity} onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantity" />
                <span className="muted w-8 self-center text-xs">{unitOf(ing.foodItemId)}</span>
                <button type="button" className="btn-danger px-2" onClick={() => setIngs(ings.filter((_, j) => j !== i))} aria-label="Remove ingredient">✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 text-sm text-emerald-600" onClick={() => setIngs([...ings, { foodItemId: "", quantity: 100 }])}>+ ingredient</button>
        </div>
        <div><label className="label" htmlFor="ri">Method</label><textarea id="ri" className="input" rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        <div><label className="label" htmlFor="rt">Tags (comma separated)</label><input id="rt" className="input" placeholder="healthy, quick" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div>
        <ErrorBox error={create.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={create.isPending}>Save recipe</button></div>
      </form>
    </Modal>
  );
}
