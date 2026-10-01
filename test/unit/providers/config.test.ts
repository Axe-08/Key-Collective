import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  PROVIDER_RESET,
  nextProviderReset,
} from "../../../src/providers/config";

describe("Provider reset configuration (WP-5.8 T-5.8.1)", () => {
  it("exposes dailyResetTz on PROVIDERS and PROVIDER_RESET", () => {
    expect(PROVIDERS.google.dailyResetTz).toBe("America/Los_Angeles");
    expect(PROVIDERS.groq.dailyResetTz).toBe("UTC");
    expect(PROVIDER_RESET.google.dailyResetTz).toBe("America/Los_Angeles");
    expect(PROVIDER_RESET.groq.dailyResetTz).toBe("UTC");
  });

  it("nextProviderReset('groq', now) returns the next UTC midnight", () => {
    // 2030-06-15 14:30:00 UTC -> next UTC midnight is 2030-06-16 00:00:00 UTC
    const now = Date.UTC(2030, 5, 15, 14, 30, 0);
    const reset = nextProviderReset("groq", now);
    expect(reset).toBe(Date.UTC(2030, 5, 16, 0, 0, 0));
    expect(reset).toBeGreaterThan(now);
  });

  it("nextProviderReset('google', now) returns the next America/Los_Angeles midnight", () => {
    // In June (PDT, UTC-7), midnight in America/Los_Angeles is 07:00:00 UTC.
    // 2030-06-15 06:59:30 UTC is 2030-06-14 23:59:30 PDT -> next LA midnight is 2030-06-15 07:00:00 UTC.
    const beforePdtMidnight = Date.UTC(2030, 5, 15, 6, 59, 30);
    const resetSummer = nextProviderReset("google", beforePdtMidnight);
    expect(resetSummer).toBe(Date.UTC(2030, 5, 15, 7, 0, 0));

    // In January (PST, UTC-8), midnight in America/Los_Angeles is 08:00:00 UTC.
    // 2030-01-15 08:30:00 UTC is 2030-01-15 00:30:00 PST -> next LA midnight is 2030-01-16 08:00:00 UTC.
    const afterPstMidnight = Date.UTC(2030, 0, 15, 8, 30, 0);
    const resetWinter = nextProviderReset("google", afterPstMidnight);
    expect(resetWinter).toBe(Date.UTC(2030, 0, 16, 8, 0, 0));
  });
});
