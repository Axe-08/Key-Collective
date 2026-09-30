export const TOKENS_PER_REQUEST_ESTIMATE = 400;

export type KeyStatus = 'HEALTHY' | 'COOLDOWN' | 'QUARANTINED' | 'REVOKED';

export type PoolType = 'PRIVATE' | 'COMMUNITY';

export function normaliseKeyStatus(
  raw: string | null,
  communityRoutingStatus?: string | null
): KeyStatus {
  const value = raw?.toLowerCase();
  switch (value) {
    case 'healthy':
      return 'HEALTHY';
    case 'invalid':
      return communityRoutingStatus === 'REVOKED' ? 'REVOKED' : 'QUARANTINED';
    case 'quarantined':
      return 'QUARANTINED';
    case 'exhausted':
    case 'rate_limited':
    case 'cooldown':
      return 'COOLDOWN';
    case 'revoked':
      return 'REVOKED';
    default:
      return 'QUARANTINED';
  }
}

export function normalisePoolType(raw: string | null): PoolType {
  if (raw == null) {
    return 'PRIVATE';
  }
  return raw.toLowerCase() === 'community' ? 'COMMUNITY' : 'PRIVATE';
}
