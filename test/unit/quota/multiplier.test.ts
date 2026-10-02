import { describe, expect, it } from "vitest";
import {
  calculateBandCapPct,
  calculateDebtCapPct,
  calculateMultiplierPct,
  calculateVestingCapPct,
  determineJailStatus,
  type CommunityKeyVestingInfo,
} from "../../../src/quota/tenant/debt";

const HOUR_MS = 3_600_000;

describe("WP-5.12 T-5.12.1 — calculateMultiplierPct with vesting_cap, debt_cap, band_cap", () => {
  it("computes vesting_cap from oldest ACTIVE OK community key age (0-2h -> 150, 2-12h -> 250, >=12h -> 450/500, none -> 100)", () => {
    const now = Date.UTC(2030, 0, 2, 12, 0, 0);

    // No community keys -> 100
    expect(calculateVestingCapPct([], false, now)).toBe(100);

    // Only OBSERVATION or QUARANTINED key -> 100
    expect(
      calculateVestingCapPct(
        [{ status: "OBSERVATION", drainState: "OK", createdAt: now - 24 * HOUR_MS }],
        false,
        now
      )
    ).toBe(100);

    // 1 hour old ACTIVE OK key -> 150
    expect(
      calculateVestingCapPct(
        [{ status: "ACTIVE", drainState: "OK", createdAt: now - 1 * HOUR_MS }],
        false,
        now
      )
    ).toBe(150);

    // 5 hours old ACTIVE OK key -> 250
    expect(
      calculateVestingCapPct(
        [{ status: "ACTIVE", drainState: "OK", createdAt: now - 5 * HOUR_MS }],
        false,
        now
      )
    ).toBe(250);

    // 15 hours old ACTIVE OK key -> 450 (untrusted), 500 (trusted)
    const oldKey: CommunityKeyVestingInfo[] = [
      { status: "ACTIVE", drainState: "OK", createdAt: now - 15 * HOUR_MS },
    ];
    expect(calculateVestingCapPct(oldKey, false, now)).toBe(450);
    expect(calculateVestingCapPct(oldKey, true, now)).toBe(500);
  });

  it("excludes DRAINED keys from vesting_cap (D-16)", () => {
    const now = Date.UTC(2030, 0, 2, 12, 0, 0);

    // Owner whose only community key is DRAINED -> vesting_cap 100
    const onlyDrained: CommunityKeyVestingInfo[] = [
      { status: "ACTIVE", drainState: "DRAINED", createdAt: now - 48 * HOUR_MS },
    ];
    expect(calculateVestingCapPct(onlyDrained, false, now)).toBe(100);
    expect(
      calculateMultiplierPct({
        keys: onlyDrained,
        now,
        debtCu: 0n,
        contributed24h: 1000n,
        trusted: true,
        utilisationPct: 20,
      })
    ).toBe(100);

    // Owner with a 48h DRAINED key and a 1h OK key -> uses the 1h OK key (150)
    const mixedKeys: CommunityKeyVestingInfo[] = [
      { status: "ACTIVE", drainState: "DRAINED", createdAt: now - 48 * HOUR_MS },
      { status: "ACTIVE", drainState: "OK", createdAt: now - 1 * HOUR_MS },
    ];
    expect(calculateVestingCapPct(mixedKeys, false, now)).toBe(150);
  });

  it("table test across vesting x debt x band combinations", () => {
    const now = Date.UTC(2030, 0, 2, 12, 0, 0);

    const cases: Array<{
      name: string;
      keyAgeHours: number | null;
      drainState?: "OK" | "DRAINED";
      debtCu: bigint;
      contributed24h: bigint;
      trusted: boolean;
      utilisationPct: number;
      expectedVesting: number;
      expectedDebt: number;
      expectedBand: number;
      expectedMultiplier: number;
    }> = [
      {
        name: "no key caps everything at 100",
        keyAgeHours: null,
        debtCu: 0n,
        contributed24h: 500n,
        trusted: false,
        utilisationPct: 10,
        expectedVesting: 100,
        expectedDebt: 450,
        expectedBand: 450,
        expectedMultiplier: 100,
      },
      {
        name: "0-2h key (150) x pristine debt (450) x low util <60% (450) -> 150",
        keyAgeHours: 1,
        debtCu: 10n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 40,
        expectedVesting: 150,
        expectedDebt: 450,
        expectedBand: 450,
        expectedMultiplier: 150,
      },
      {
        name: "2-12h key (250) x pristine debt (450) x low util <60% (450) -> 250",
        keyAgeHours: 6,
        debtCu: 20n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 55,
        expectedVesting: 250,
        expectedDebt: 450,
        expectedBand: 450,
        expectedMultiplier: 250,
      },
      {
        name: ">=12h key (450) x soft warning debt 75/100 (150) x low util <60% (450) -> 150",
        keyAgeHours: 24,
        debtCu: 75n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 30,
        expectedVesting: 450,
        expectedDebt: 150,
        expectedBand: 450,
        expectedMultiplier: 150,
      },
      {
        name: ">=12h key (450) x hard jail debt 120/100 (100) x low util <60% (450) -> 100",
        keyAgeHours: 24,
        debtCu: 120n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 30,
        expectedVesting: 450,
        expectedDebt: 100,
        expectedBand: 450,
        expectedMultiplier: 100,
      },
      {
        name: ">=12h key (450) x pristine debt (450) x medium util 60-79% (300) -> 300",
        keyAgeHours: 24,
        debtCu: 0n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 65,
        expectedVesting: 450,
        expectedDebt: 450,
        expectedBand: 300,
        expectedMultiplier: 300,
      },
      {
        name: ">=12h key (450) x pristine debt (450) x high util 80-94% (150) -> 150",
        keyAgeHours: 24,
        debtCu: 0n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 85,
        expectedVesting: 450,
        expectedDebt: 450,
        expectedBand: 150,
        expectedMultiplier: 150,
      },
      {
        name: ">=12h key (450) x pristine debt (450) x saturated util >=95% (100) -> 100",
        keyAgeHours: 24,
        debtCu: 0n,
        contributed24h: 100n,
        trusted: false,
        utilisationPct: 95,
        expectedVesting: 450,
        expectedDebt: 450,
        expectedBand: 100,
        expectedMultiplier: 100,
      },
      {
        name: "trusted >=12h key (500) x pristine debt (500) x low util <60% -> 500",
        keyAgeHours: 24,
        debtCu: 0n,
        contributed24h: 200n,
        trusted: true,
        utilisationPct: 25,
        expectedVesting: 500,
        expectedDebt: 500,
        expectedBand: 500,
        expectedMultiplier: 500,
      },
    ];

    for (const tc of cases) {
      const keys: CommunityKeyVestingInfo[] =
        tc.keyAgeHours === null
          ? []
          : [
              {
                status: "ACTIVE",
                drainState: tc.drainState ?? "OK",
                createdAt: now - tc.keyAgeHours * HOUR_MS,
              },
            ];

      expect(calculateVestingCapPct(keys, tc.trusted, now), `${tc.name} (vesting)`).toBe(
        tc.expectedVesting
      );
      expect(
        calculateDebtCapPct(tc.debtCu, tc.contributed24h, tc.trusted),
        `${tc.name} (debt)`
      ).toBe(tc.expectedDebt);
      expect(
        calculateBandCapPct(tc.utilisationPct, tc.trusted),
        `${tc.name} (band)`
      ).toBe(tc.expectedBand);
      expect(
        calculateMultiplierPct({
          keys,
          now,
          debtCu: tc.debtCu,
          contributed24h: tc.contributed24h,
          trusted: tc.trusted,
          utilisationPct: tc.utilisationPct,
        }),
        `${tc.name} (min)`
      ).toBe(tc.expectedMultiplier);
    }
  });

  it("derives determineJailStatus directly from ratio_pct without depending on multiplier_pct", () => {
    // Even if vesting_cap or band_cap forces multiplier_pct = 100, low debt is PRISTINE
    expect(determineJailStatus(0n, 0n)).toBe("PRISTINE");
    expect(determineJailStatus(40n, 100n)).toBe("PRISTINE");
    expect(determineJailStatus(50n, 100n)).toBe("PRISTINE");
    expect(determineJailStatus(51n, 100n)).toBe("SOFT_WARNING");
    expect(determineJailStatus(100n, 100n)).toBe("SOFT_WARNING");
    expect(determineJailStatus(101n, 100n)).toBe("HARD_JAIL");
    expect(determineJailStatus(2n, 0n)).toBe("HARD_JAIL");
  });
});
