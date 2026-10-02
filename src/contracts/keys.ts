export const TOKENS_PER_REQUEST_ESTIMATE = 400;

export type KeyStatus = 'HEALTHY' | 'COOLDOWN' | 'QUARANTINED' | 'REVOKED';

export type PoolType = 'PRIVATE' | 'COMMUNITY';

export function normaliseKeyStatus(
  raw: string | null,
  _communityRoutingStatus?: string | null
): KeyStatus {
  switch (raw) {
    case 'HEALTHY':
    case 'COOLDOWN':
    case 'QUARANTINED':
    case 'REVOKED':
      return raw;
    default:
      throw new Error(`Invalid key status: ${String(raw)}`);
  }
}

export function normalisePoolType(raw: string | null): PoolType {
  if (raw == null) {
    return 'PRIVATE';
  }
  return raw === 'COMMUNITY' ? 'COMMUNITY' : 'PRIVATE';
}
