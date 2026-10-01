import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CatalogItem, type InventoryBatch } from "../api";
import { Badge, Empty, ErrorBox, Loading, Modal, Tabs, expiryTone } from "../components/ui";
import { CATEGORY_EMOJI, defaultServing, fmtQty, relDays, titleCase } from "../format";
import { useCatalog, useStockMutation } from "../hooks";

type Loc = "ALL" | "FRIDGE" | "FREEZER" | "PANTRY";

export function Fridge() {
  const inventory = useQuery({ queryKey: ["inventory"], queryFn: () => api<InventoryBatch[]>("/inventory") });
  const [loc, setLoc] = useState<Loc>("FRIDGE");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [using, setUsing] = useState<InventoryBatch["foodItem"] | null>(null);

  const groups = useMemo(() => {
    const byFood = new Map<string, InventoryBatch[]>();
    for (const b of inventory.data ?? []) {
      if (loc !== "ALL" && b.location !== loc) continue;
      if (q && !b.foodItem.name.toLowerCase().includes(q.toLowerCase())) continue;
      byFood.set(b.foodItemId, [...(byFood.get(b.foodItemId) ?? []), b]);
    }
    return [...byFood.values()].sort((a, b) => (a[0].daysToExpiry ?? 9999) - (b[0].daysToExpiry ?? 9999));
  }, [inventory.data, loc, q]);

  const discard = useStockMutation((id: string) => api(`/inventory/batches/${id}/discard`, { method: "POST", body: {} }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">What's in stock</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}>+ Add groceries</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={loc} onChange={setLoc} options={[{ value: "FRIDGE", label: "🧊 Fridge" }, { value: "FREEZER", label: "❄️ Freezer" }, { value: "PANTRY", label: "🥫 Pantry" }, { value: "ALL", label: "All" }]} />
        <input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
      </div>
      <ErrorBox error={inventory.error ?? discard.error} />

      {inventory.isLoading ? <Loading /> : groups.length === 0 ? (
        <Empty title={q ? "No matches" : "Nothing here yet"}>Add groceries to start tracking.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((bs) => {
            const f = bs[0].foodItem;
            const total = bs.reduce((s, b) => s + b.remainingQuantity, 0);
            const soonest = bs[0].daysToExpiry;
            return (
              <div key={f.id} className="card flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/items/${f.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <span aria-hidden>{CATEGORY_EMOJI[f.category] ?? "🍽️"}</span>{f.name}
                  </Link>
                  <Badge tone={expiryTone(soonest)}>{soonest === null ? "no date" : soonest < 0 ? "past date" : relDays(soonest)}</Badge>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-semibold tabular-nums">{fmtQty(total, f.defaultUnit)}</span>
                  <span className="muted text-xs">{bs.length} pack{bs.length > 1 ? "s" : ""} · {titleCase(f.category)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (total / Math.max(f.unitSize, 1)) * 100)}%` }} />
                </div>
                {bs.length > 1 || (soonest !== null && soonest < 0) ? (
                  <ul className="space-y-1 text-xs">
                    {bs.map((b) => (
                      <li key={b.id} className="flex items-center justify-between">
                        <span className="muted">{fmtQty(b.remainingQuantity, b.unit)} · {b.expiresAt ? `exp ${new Date(b.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "no date"}</span>
                        <button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => discard.mutate(b.id)} disabled={discard.isPending}>Bin</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-auto flex gap-2 pt-1">
                  <button className="btn-outline flex-1" onClick={() => setUsing(f)}>Use some</button>
                  {bs.length === 1 && !(soonest !== null && soonest < 0) && <button className="btn-danger" onClick={() => discard.mutate(bs[0].id)} disabled={discard.isPending}>Bin</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddGroceriesModal open={adding} onClose={() => setAdding(false)} />
      <UseModal food={using} onClose={() => setUsing(null)} />
    </div>
  );
}

function UseModal({ food, onClose }: { food: InventoryBatch["foodItem"] | null; onClose: () => void }) {
  const [qty, setQty] = useState<number | "">("");
  const [log, setLog] = useState(true);
  const consume = useStockMutation(
    (v: { foodItemId: string; quantity: number; logAsEaten: boolean }) => api<{ taken: number }>("/inventory/consume", { body: v }),
    () => { setQty(""); onClose(); },
  );
  if (!food) return null;
  const amount = qty === "" ? defaultServing(food.defaultUnit, food.unitSize, food.isDrink) : qty;
  return (
    <Modal open onClose={onClose} title={`Use ${food.name}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); consume.mutate({ foodItemId: food.id, quantity: amount, logAsEaten: log }); }}>
        <div>
          <label className="label" htmlFor="qty">Amount ({food.defaultUnit})</label>
          <input id="qty" className="input" type="number" min={0.1} step="any" value={qty === "" ? amount : qty} onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} />
          <div className="mt-2 flex flex-wrap gap-1">
            {(food.defaultUnit === "pcs" ? [1, 2, 3] : food.isDrink ? [150, 250, 330, 500] : [50, 100, 200, food.unitSize]).map((n) => (
              <button type="button" key={n} className="btn-outline px-2 py-1 text-xs" onClick={() => setQty(n)}>{fmtQty(n, food.defaultUnit)}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> I ate/drank this — add it to my log</label>
        <ErrorBox error={consume.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={consume.isPending}>Take from stock</button></div>
      </form>
    </Modal>
  );
}

export function AddGroceriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalog = useCatalog();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [packs, setPacks] = useState(1);
  const [expires, setExpires] = useState("");
  const [creating, setCreating] = useState(false);
  const reset = () => { setPicked(null); setSearch(""); setPacks(1); setExpires(""); setCreating(false); };
  const add = useStockMutation(
    (v: { foodItemId: string; quantity: number; expiresAt?: string; pricePaid?: number | null }) => api("/inventory", { body: v }),
    reset,
  );

  const matches = (catalog.data ?? []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
  const defaultExpiry = (c: CatalogItem) => new Date(Date.now() + c.typicalShelfLifeDays * 86_400_000).toISOString().slice(0, 10);

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Add groceries">
      {creating ? <NewItemForm initialName={search} onDone={(c) => { setCreating(false); setPicked(c); }} onCancel={() => setCreating(false)} /> : !picked ? (
        <div className="space-y-3">
          <input className="input" autoFocus placeholder="Search your items, e.g. milk" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {matches.map((c) => (
              <li key={c.id}>
                <button className="flex w-full items-center justify-between py-2 text-left text-sm hover:text-emerald-600" onClick={() => { setPicked(c); setExpires(defaultExpiry(c)); }}>
                  <span>{CATEGORY_EMOJI[c.category]} {c.name}</span>
                  <span className="muted text-xs">{c.stock > 0 ? `${fmtQty(c.stock, c.defaultUnit)} in stock` : "none in stock"}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-outline w-full" onClick={() => setCreating(true)}>+ New item{search ? ` "${search}"` : ""}</button>
          {add.isSuccess && <p className="text-sm text-emerald-600">Added ✓ — add another?</p>}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ foodItemId: picked.id, quantity: packs * picked.unitSize, expiresAt: expires || undefined, pricePaid: picked.pricePerPack ? Math.round(picked.pricePerPack * packs * 100) / 100 : null });
        }}>
          <div className="flex items-center justify-between"><span className="font-medium">{CATEGORY_EMOJI[picked.category]} {picked.name}</span><button type="button" className="btn-ghost text-xs" onClick={() => setPicked(null)}>Change</button></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="packs">Packs ({fmtQty(picked.unitSize, picked.defaultUnit)} each)</label><input id="packs" className="input" type="number" min={1} value={packs} onChange={(e) => setPacks(Math.max(1, Number(e.target.value)))} /></div>
            <div><label className="label" htmlFor="exp">Best before</label><input id="exp" className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
          </div>
          <ErrorBox error={add.error} />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPicked(null)}>Back</button><button className="btn-primary" disabled={add.isPending}>Add to {titleCase(picked.location)}</button></div>
        </form>
      )}
    </Modal>
  );
}

const CATEGORIES = ["DAIRY", "PRODUCE", "MEAT", "FISH", "EGGS", "BAKERY", "DRINKS", "CONDIMENTS", "FROZEN", "SNACKS", "PANTRY"];

function NewItemForm({ initialName, onDone, onCancel }: { initialName: string; onDone: (c: CatalogItem) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: initialName, category: "PRODUCE", defaultUnit: "g", unitSize: 500, typicalShelfLifeDays: 7, location: "FRIDGE", isStaple: false, kcal: "", sugarG: "" });
  const create = useStockMutation(
    () => api<CatalogItem>("/items", {
      body: { ...f, isDrink: f.category === "DRINKS", kcal: f.kcal === "" ? null : Number(f.kcal), sugarG: f.sugarG === "" ? null : Number(f.sugarG) },
    }),
  );
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const c = await create.mutateAsync(undefined); onDone({ ...c, stock: 0, nextExpiry: null, favouriteId: null }); }}>
      <div><label className="label" htmlFor="nm">Name</label><input id="nm" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="cat">Category</label><select id="cat" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></div>
        <div><label className="label" htmlFor="loc">Stored in</label><select id="loc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>{["FRIDGE", "FREEZER", "PANTRY"].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></div>
        <div><label className="label" htmlFor="unit">Measured in</label><select id="unit" className="input" value={f.defaultUnit} onChange={(e) => setF({ ...f, defaultUnit: e.target.value })}><option value="g">grams</option><option value="ml">millilitres</option><option value="pcs">pieces</option></select></div>
        <div><label className="label" htmlFor="size">Pack size</label><input id="size" className="input" type="number" min={1} value={f.unitSize} onChange={(e) => setF({ ...f, unitSize: Number(e.target.value) })} /></div>
        <div><label className="label" htmlFor="life">Keeps for (days)</label><input id="life" className="input" type="number" min={1} value={f.typicalShelfLifeDays} onChange={(e) => setF({ ...f, typicalShelfLifeDays: Number(e.target.value) })} /></div>
        <div><label className="label" htmlFor="kcal">kcal per 100{f.defaultUnit === "pcs" ? " (per piece)" : f.defaultUnit}</label><input id="kcal" className="input" type="number" min={0} value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} placeholder="optional" /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isStaple} onChange={(e) => setF({ ...f, isStaple: e.target.checked })} /> Staple — we should never run out</label>
      <ErrorBox error={create.error} />
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Back</button><button className="btn-primary" disabled={create.isPending}>Create item</button></div>
    </form>
  );
}
