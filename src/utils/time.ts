const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

function fromNumeric(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && n >= 1e12) return n;
  if (Number.isInteger(n) && n >= 0 && n < 1e12) return n * 1000;
  return null;
}

export function toEpochMs(value: unknown): number | null {
  if (typeof value === "string" && NUMERIC_STRING_RE.test(value)) {
    return fromNumeric(Number(value));
  }
  if (typeof value === "number") {
    return fromNumeric(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
