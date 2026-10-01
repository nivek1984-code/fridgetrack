import type { Unit } from "./api";

export function fmtQty(qty: number, unit: Unit | string) {
  if (unit === "pcs") return `${Math.round(qty * 10) / 10} pcs`;
  if (qty >= 1000) return `${Math.round(qty / 100) / 10} ${unit === "g" ? "kg" : "L"}`;
  return `${Math.round(qty)} ${unit}`;
}

// Local calendar date (en-CA formats as YYYY-MM-DD).
export const todayISO = () => new Date().toLocaleDateString("en-CA");

export function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

export function relDays(days: number | null) {
  if (days === null) return "2+ weeks";
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const CATEGORY_EMOJI: Record<string, string> = {
  DAIRY: "🥛", PRODUCE: "🥬", MEAT: "🥩", FISH: "🐟", EGGS: "🥚", BAKERY: "🍞", DRINKS: "🥤",
  CONDIMENTS: "🫙", FROZEN: "🧊", SNACKS: "🍪", PANTRY: "🥫",
};

/** Sensible default amount for "I had some" quick actions. */
export function defaultServing(unit: Unit, unitSize: number, isDrink: boolean) {
  if (unit === "pcs") return 1;
  if (isDrink) return Math.min(250, unitSize);
  return Math.min(100, unitSize);
}
