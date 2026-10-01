import { describe, expect, it } from "vitest";
import { daysUntilExpiry, expiryStatus, fmtExpiry, fmtQty, groupStock, locationName } from "../src/services/expiry.js";

// Mid-afternoon on 1 Oct (local time); expiry dates are stored as midnight UTC.
const now = new Date(2026, 9, 1, 12, 24);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const batch = (qty: number, expires: string | null, location = "FRIDGE") =>
  ({ foodItemId: "milk", remainingQuantity: qty, unit: "ml", expiresAt: expires ? day(expires) : null, location });

describe("daysUntilExpiry", () => {
  it("counts calendar days, not rounded milliseconds from the current time", () => {
    expect(daysUntilExpiry(day("2026-10-02"), now)).toBe(1);
    expect(daysUntilExpiry(day("2026-10-01"), now)).toBe(0);
    expect(daysUntilExpiry(day("2026-09-28"), now)).toBe(-3);
    expect(daysUntilExpiry(day("2026-10-02"), new Date(2026, 9, 1, 23, 59))).toBe(1);
    expect(daysUntilExpiry(null, now)).toBeNull();
  });
});

describe("expiryStatus", () => {
  it("derives EXPIRED only once the date has passed", () => {
    expect(expiryStatus(-1)).toBe("EXPIRED");
    expect(expiryStatus(0)).toBe("EXPIRING");
    expect(expiryStatus(2)).toBe("EXPIRING");
    expect(expiryStatus(3)).toBe("OK");
    expect(expiryStatus(null)).toBe("NO_DATE");
  });
});

describe("groupStock", () => {
  it("keeps each batch's quantity and date instead of merging them", () => {
    const [milk] = groupStock([batch(2000, "2026-10-07"), batch(1341.3, "2026-10-02")], now);
    expect(milk.total).toBeCloseTo(3341.3);
    expect(milk.batches.map((b) => [b.remainingQuantity, b.daysToExpiry])).toEqual([[1341.3, 1], [2000, 6]]);
    expect(milk.next?.remainingQuantity).toBe(1341.3);
  });

  it("splits expired stock out and points `next` at the first batch still in date", () => {
    const [milk] = groupStock([batch(500, "2026-09-29"), batch(1000, null), batch(1000, "2026-10-05")], now);
    expect(milk.expired).toBe(500);
    expect(milk.usable).toBe(2000);
    expect(milk.batches[0].expiryStatus).toBe("EXPIRED");
    expect(milk.batches.at(-1)?.expiryStatus).toBe("NO_DATE");
    expect(milk.next?.daysToExpiry).toBe(4);
  });

  it("records every location an item is stored in", () => {
    const [milk] = groupStock([batch(1, "2026-10-05"), batch(1, "2026-12-01", "FREEZER")], now);
    expect(milk.locations).toEqual(["FRIDGE", "FREEZER"]);
  });
});

describe("display helpers", () => {
  it("pluralises pieces and scales ml/g", () => {
    expect(fmtQty(1, "pcs")).toBe("1 pc");
    expect(fmtQty(2, "pcs")).toBe("2 pcs");
    expect(fmtQty(850, "ml")).toBe("850 ml");
    expect(fmtQty(1341.3, "ml")).toBe("1.3 L");
    expect(fmtQty(2000, "g")).toBe("2 kg");
  });

  it("names locations and expiry in words", () => {
    expect(locationName("FREEZER")).toBe("Freezer");
    expect(fmtExpiry(1)).toBe("expires tomorrow");
    expect(fmtExpiry(-3)).toBe("expired 3 days ago");
  });
});
