import { useEffect, type ReactNode } from "react";

export function Spinner({ className = "" }: { className?: string }) {
  return <div className={`h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent ${className}`} role="status" aria-label="Loading" />;
}

export function Loading() {
  return <div className="grid place-items-center py-16"><Spinner /></div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
      <p className="font-medium">{title}</p>
      {children && <div className="muted mt-1">{children}</div>}
    </div>
  );
}

const TONES = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  gray: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function expiryTone(days: number | null): Tone {
  if (days === null) return "gray";
  if (days < 0) return "red";
  if (days <= 2) return "amber";
  return "green";
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl dark:bg-stone-900" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const color = tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "green" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="card">
      <div className="muted text-xs">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="muted mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

/** Horizontal bar showing value vs target. */
export function Meter({ value, target, invert = false }: { value: number; target: number; invert?: boolean }) {
  const pct = Math.min(150, (value / Math.max(target, 1)) * 100);
  const over = pct > 100;
  const good = invert ? over : !over;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
      <div className={`h-full rounded-full ${good ? "bg-emerald-500" : pct > 125 ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${(pct / 150) * 100}%` }} />
      <div className="absolute top-0 h-full w-0.5 bg-stone-500/60" style={{ left: `${(100 / 150) * 100}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${value === o.value ? "bg-white shadow-sm dark:bg-stone-900" : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
