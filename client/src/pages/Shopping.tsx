import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ShoppingItem } from "../api";
import { Badge, Empty, ErrorBox, Loading } from "../components/ui";
import { CATEGORY_EMOJI, fmtQty, titleCase } from "../format";
import { useCatalog, useStockMutation } from "../hooks";

const REASON: Record<ShoppingItem["reason"], { label: string; tone: "amber" | "red" | "gray" }> = {
  RUN_OUT: { label: "running out", tone: "amber" }, EXPIRING: { label: "expiring", tone: "red" }, MANUAL: { label: "added", tone: "gray" },
};

export function Shopping() {
  const list = useQuery({ queryKey: ["shopping"], queryFn: () => api<ShoppingItem[]>("/shopping") });
  const catalog = useCatalog();
  const [text, setText] = useState("");
  const add = useStockMutation(() => {
    const match = catalog.data?.find((c) => c.name.toLowerCase() === text.trim().toLowerCase());
    return api("/shopping", { body: match ? { foodItemId: match.id, quantity: match.unitSize } : { name: text.trim(), quantity: 1 } });
  }, () => setText(""));
  const toggle = useStockMutation((i: ShoppingItem) => api(`/shopping/${i.id}`, { method: "PATCH", body: { checked: !i.checked } }));
  const remove = useStockMutation((id: string) => api(`/shopping/${id}`, { method: "DELETE" }));
  const checkout = useStockMutation(() => api<{ stocked: number; cleared: number }>("/shopping/checkout", { method: "POST" }));
  const fromProposal = useStockMutation(() => api<{ added: number }>("/shopping/from-proposal", { body: { trip: "main" } }));

  const items = list.data ?? [];
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  // Group open items by aisle-ish category for easier shopping.
  const groups = new Map<string, ShoppingItem[]>();
  for (const i of open) {
    const cat = i.foodItem?.category ?? "OTHER";
    groups.set(cat, [...(groups.get(cat) ?? []), i]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Shopping list</h1>
        <button className="btn-outline" onClick={() => fromProposal.mutate(undefined)} disabled={fromProposal.isPending}>✨ Add predicted needs</button>
      </div>
      {fromProposal.data && <p className="text-sm text-emerald-600">{fromProposal.data.added ? `Added ${fromProposal.data.added} items from the next grocery run prediction.` : "Everything predicted is already on the list."}</p>}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(undefined); }}>
        <input className="input" list="catalog-names" placeholder="Add an item, e.g. Eggs or Birthday candles" value={text} onChange={(e) => setText(e.target.value)} aria-label="New shopping item" />
        <datalist id="catalog-names">{catalog.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <button className="btn-primary" disabled={add.isPending || !text.trim()}>Add</button>
      </form>
      <ErrorBox error={list.error ?? add.error ?? toggle.error ?? checkout.error} />

      {list.isLoading ? <Loading /> : items.length === 0 ? <Empty title="The list is empty">Use “Add predicted needs” to fill it from your fridge forecast.</Empty> : (
        <>
          {[...groups].map(([cat, is]) => (
            <div key={cat} className="card">
              <div className="muted mb-2 text-xs font-medium uppercase tracking-wide">{CATEGORY_EMOJI[cat] ?? "📦"} {cat === "OTHER" ? "Other" : titleCase(cat)}</div>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {is.map((i) => <Row key={i.id} item={i} onToggle={() => toggle.mutate(i)} onRemove={() => remove.mutate(i.id)} />)}
              </ul>
            </div>
          ))}
          {done.length > 0 && (
            <div className="card">
              <div className="mb-2 flex items-center justify-between">
                <span className="muted text-xs font-medium uppercase tracking-wide">In the trolley ({done.length})</span>
                <button className="btn-primary" onClick={() => checkout.mutate(undefined)} disabled={checkout.isPending}>Done shopping → put away</button>
              </div>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {done.map((i) => <Row key={i.id} item={i} onToggle={() => toggle.mutate(i)} onRemove={() => remove.mutate(i.id)} />)}
              </ul>
              <p className="muted mt-2 text-xs">“Done shopping” adds ticked items to your fridge with their usual best-before dates.</p>
            </div>
          )}
          {checkout.data && <p className="text-sm text-emerald-600">Put away {checkout.data.stocked} item{checkout.data.stocked === 1 ? "" : "s"} ✓</p>}
        </>
      )}
    </div>
  );
}

function Row({ item, onToggle, onRemove }: { item: ShoppingItem; onToggle: () => void; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <input type="checkbox" className="h-5 w-5 accent-emerald-600" checked={item.checked} onChange={onToggle} aria-label={`Got ${item.name}`} />
      <div className={`min-w-0 flex-1 ${item.checked ? "text-stone-400 line-through" : ""}`}>
        <div className="truncate">{item.name}</div>
        <div className="muted text-xs">{item.foodItem ? fmtQty(item.quantity, item.unit) : `×${item.quantity}`}{item.addedBy ? ` · ${item.addedBy.name}` : ""}</div>
      </div>
      <Badge tone={REASON[item.reason].tone}>{REASON[item.reason].label}</Badge>
      <button className="btn-danger px-1.5 py-0.5 text-xs" onClick={onRemove} aria-label={`Remove ${item.name}`}>✕</button>
    </li>
  );
}
