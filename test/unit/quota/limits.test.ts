import { describe, it, expect } from 'vitest';
import { getTierLimits, calculateProjectQuota } from '../../../src/quota/limits';
import { TIER_LIMITS_MAP, UserTier } from '../../../src/contracts/v3_types';

describe('src/quota/limits.ts', () => {
  describe('getTierLimits', () => {
    it('returns exact TierLimits for all valid tiers', () => {
      const tiers: UserTier[] = [
        'admin',
        'ultra',
        'max',
        'builder',
        'probationary',
        'demo',
        'suspended',
      ];

      for (const tier of tiers) {
        const limits = getTierLimits(tier);
        expect(limits).toEqual(TIER_LIMITS_MAP[tier]);
      }
    });

    it('returns suspended limits as fallback when tier is unrecognized', () => {
      const invalidTier = 'unknown_tier' as unknown as UserTier;
      const limits = getTierLimits(invalidTier);
      expect(limits).toEqual(TIER_LIMITS_MAP.suspended);
    });
  });

  describe('calculateProjectQuota', () => {
    it('returns root tenant RPM limit when projectMaxSubCap is undefined', () => {
      expect(calculateProjectQuota('builder')).toBe(20);
      expect(calculateProjectQuota('admin')).toBe(Infinity);
      expect(calculateProjectQuota('max')).toBe(60);
      expect(calculateProjectQuota('probationary')).toBe(2);
      expect(calculateProjectQuota('suspended')).toBe(0);
    });

    it('returns root tenant RPM limit when projectMaxSubCap is null', () => {
      expect(calculateProjectQuota('builder', null)).toBe(20);
      expect(calculateProjectQuota('admin', null)).toBe(Infinity);
    });

    it('applies Math.min(tenantLimit, projectMaxSubCap) when sub-cap is lower than tenant limit', () => {
      expect(calculateProjectQuota('builder', 5)).toBe(5);
      expect(calculateProjectQuota('max', 30)).toBe(30);
      expect(calculateProjectQuota('admin', 100)).toBe(100);
      expect(calculateProjectQuota('ultra', 500)).toBe(500);
      expect(calculateProjectQuota('probationary', 1)).toBe(1);
    });

    it('clamps to tenant root limit when projectMaxSubCap exceeds tenant limit', () => {
      // Builder root limit is 20 RPM
      expect(calculateProjectQuota('builder', 50)).toBe(20);
      // Max root limit is 60 RPM
      expect(calculateProjectQuota('max', 100)).toBe(60);
      // Probationary root limit is 2 RPM
      expect(calculateProjectQuota('probationary', 10)).toBe(2);
      // Suspended root limit is 0 RPM
      expect(calculateProjectQuota('suspended', 10)).toBe(0);
    });

    it('correctly handles edge case of 0 sub-cap', () => {
      expect(calculateProjectQuota('builder', 0)).toBe(0);
      expect(calculateProjectQuota('admin', 0)).toBe(0);
    });
  });
});
