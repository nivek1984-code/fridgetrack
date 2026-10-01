import type { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);

/** Validate a request body/query with zod, turning failures into 400s. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, msg);
  }
  return r.data;
}

export const DAY_MS = 86_400_000;
/** Midnight UTC of the *local* calendar date — the app stores date-only values (meal plan days, expiry days) this way. */
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
export const r1 = (x: number) => Math.round(x * 10) / 10;
