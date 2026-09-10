/**
 * Quota and Tier Limit boundary evaluation for Key Collective v3.
 *
 * Enforces per-tenant and per-project rate limits based on data contracts.
 * Guarantees zero floating-point math and strict TypeScript safety.
 */

import {
  TierLimits,
  TIER_LIMITS_MAP,
  UserTier,
} from '../contracts/v3_types';

/**
 * Returns the configured limits for a given user tier from TIER_LIMITS_MAP.
 * Defaults to suspended tier limits if the tier is unknown.
 *
 * @param tier - The UserTier to look up.
 * @returns The corresponding TierLimits definition.
 */
export function getTierLimits(tier: UserTier): TierLimits {
  const limits = TIER_LIMITS_MAP[tier];
  if (!limits) {
    return TIER_LIMITS_MAP.suspended;
  }
  return limits;
}

/**
 * Calculates the effective project RPM quota, ensuring that any configured
 * projectMaxSubCap does not exceed the root limit of the tenant tier.
 *
 * Applies Math.min(tenantLimit, projectMaxSubCap) logic when a sub-cap is provided.
 *
 * @param tenantTier - The tier of the root tenant.
 * @param projectMaxSubCap - Optional project-specific sub-cap on RPM.
 * @returns The resolved effective RPM limit.
 */
export function calculateProjectQuota(
  tenantTier: UserTier,
  projectMaxSubCap?: number | null
): number {
  const tenantLimit = getTierLimits(tenantTier).rpmLimit;

  if (projectMaxSubCap !== undefined && projectMaxSubCap !== null) {
    return Math.min(tenantLimit, projectMaxSubCap);
  }

  return tenantLimit;
}

export { TIER_LIMITS_MAP };
