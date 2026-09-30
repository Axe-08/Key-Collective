import { describe, expect, it } from "vitest";
import { toEpochMs } from "../../../src/utils/time";

describe("toEpochMs", () => {
  it("treats large integers as milliseconds", () => {
    expect(toEpochMs(1700000000000)).toBe(1700000000000);
  });

  it("treats small non-negative integers as seconds", () => {
    expect(toEpochMs(1700000000)).toBe(1700000000000);
  });

  it("parses ISO-8601 strings to the same instant", () => {
    const iso = new Date(1700000000000).toISOString();
    expect(toEpochMs(iso)).toBe(1700000000000);
  });

  it("agrees across seconds, milliseconds and ISO-8601 for the same instant", () => {
    const ms = toEpochMs(1700000000000);
    const sec = toEpochMs(1700000000);
    const iso = toEpochMs(new Date(1700000000000).toISOString());
    expect(ms).toBe(sec);
    expect(sec).toBe(iso);
  });

  it("parses numeric strings for both seconds and milliseconds forms", () => {
    expect(toEpochMs("1700000000000")).toBe(1700000000000);
    expect(toEpochMs("1700000000")).toBe(1700000000000);
  });

  it("returns null for garbage inputs", () => {
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toEpochMs({})).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(NaN)).toBeNull();
  });
});
