/**
 * @file helpers.ts
 * Formatting and inspection utilities for Tenant Surveillance.
 */

import type { TenantSurveillanceRow } from '../../../../../src/contracts/v3_5_types';
import type { UserTier } from '../../../../../src/contracts/v3_types';

export function isAnomaly(tenant: TenantSurveillanceRow): boolean {
  if (tenant.rpmLimit <= 0 || tenant.rpmLimit === Infinity) return false;
  return (tenant.currentRpm / tenant.rpmLimit) >= 0.85;
}

export function getTierBadgeClass(tier: UserTier): string {
  switch (tier) {
    case 'admin':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'ultra':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-bold';
    case 'max':
      return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
    case 'builder':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'probationary':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
    case 'demo':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  }
}

export function getAuthProviderIcon(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'github':
      return 'code';
    case 'google':
      return 'account_circle';
    default:
      return 'mail';
  }
}

export function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}
