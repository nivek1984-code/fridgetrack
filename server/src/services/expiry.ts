// Pure helpers for presenting stock: expiry in calendar days, derived expiry status, and per-food grouping
// that keeps each batch's own quantity, date and location instead of merging them. No DB access, so the
// report script and tests can use them directly.
import { DAY_MS, startOfDay } from "../http.js";

/** Batches expiring within this many days (today included) count as "expiring soon". */
export const EXPIRING_SOON_DAYS = 2;

export type ExpiryStatus = "EXPIRED" | "EXPIRING" | "OK" | "NO_DATE";

/** Midnight UTC of a stored date-only value (or of the UTC day of a full timestamp). */
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Whole calendar days until `expiresAt`, counted from the local calendar date of `now`:
 * 0 = expires today, 1 = tomorrow, -1 = expired yesterday. Never rounds raw milliseconds.
 */
export function daysUntilExpiry(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.round((utcDay(expiresAt) - startOfDay(now).getTime()) / DAY_MS);
}

/** Expired means the date is before today; food is still good on its expiry day. */
export function expiryStatus(days: number | null): ExpiryStatus {
  if (days === null) return "NO_DATE";
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRING_SOON_DAYS) return "EXPIRING";
  return "OK";
}

type BatchLike = { foodItemId: string; remainingQuantity: number; unit: string; expiresAt: Date | null; location: string };

export type BatchView<B> = B & { daysToExpiry: number | null; expiryStatus: ExpiryStatus };

export type FoodStock<B> = {
  foodItemId: string;
  unit: string;
  total: number;
  /** Not yet past its date. */
  usable: number;
  expired: number;
  /** Soonest non-expired batch, if any. */
  next: BatchView<B> | null;
  locations: string[];
  /** Sorted soonest expiry first; undated batches last. */
  batches: BatchView<B>[];
};

/** Group active batches by food without losing each batch's expiry date and location. */
export function groupStock<B extends BatchLike>(batches: B[], now: Date = new Date()): FoodStock<B>[] {
  const byFood = new Map<string, FoodStock<B>>();
  for (const b of batches) {
    const days = daysUntilExpiry(b.expiresAt, now);
    const view = { ...b, daysToExpiry: days, expiryStatus: expiryStatus(days) };
    const e = byFood.get(b.foodItemId) ?? { foodItemId: b.foodItemId, unit: b.unit, total: 0, usable: 0, expired: 0, next: null, locations: [], batches: [] };
    e.total += b.remainingQuantity;
    if (view.expiryStatus === "EXPIRED") e.expired += b.remainingQuantity;
    else e.usable += b.remainingQuantity;
    if (!e.locations.includes(b.location)) e.locations.push(b.location);
    e.batches.push(view);
    byFood.set(b.foodItemId, e);
  }
  const key = (d: number | null) => d ?? Infinity;
  for (const e of byFood.values()) {
    e.batches.sort((a, b) => key(a.daysToExpiry) - key(b.daysToExpiry));
    e.next = e.batches.find((b) => b.expiryStatus !== "EXPIRED") ?? null;
  }
  return [...byFood.values()];
}

// ---- Display helpers ----

const LOCATION_NAMES: Record<string, string> = { FRIDGE: "Fridge", FREEZER: "Freezer", PANTRY: "Pantry" };
export const locationName = (loc: string) => LOCATION_NAMES[loc] ?? loc.charAt(0) + loc.slice(1).toLowerCase();

const num = (n: number, d: number) => n.toLocaleString("en-GB", { maximumFractionDigits: d });

/** "1 pc", "2 pcs", "850 ml", "1.3 L", "2 kg". */
export function fmtQty(qty: number, unit: string) {
  if (unit === "pcs") {
    const n = Math.round(qty * 10) / 10;
    return `${num(n, 1)} ${n === 1 ? "pc" : "pcs"}`;
  }
  if (qty >= 1000 && (unit === "ml" || unit === "g")) return `${num(qty / 1000, 1)} ${unit === "ml" ? "L" : "kg"}`;
  return `${num(qty, 0)} ${unit}`;
}

/** "expired 2 days ago", "expired yesterday", "expires today", "expires tomorrow", "expires in 5 days". */
export function fmtExpiry(days: number | null) {
  if (days === null) return "no date";
  if (days < -1) return `expired ${-days} days ago`;
  if (days === -1) return "expired yesterday";
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}
