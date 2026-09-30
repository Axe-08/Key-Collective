import { describe, expect, it } from 'vitest';
import { normaliseKeyStatus, normalisePoolType } from '../../../src/contracts/keys';

describe('normaliseKeyStatus', () => {
  it('maps Healthy variants to HEALTHY', () => {
    expect(normaliseKeyStatus('Healthy')).toBe('HEALTHY');
    expect(normaliseKeyStatus('healthy')).toBe('HEALTHY');
    expect(normaliseKeyStatus('HEALTHY')).toBe('HEALTHY');
  });

  it('maps invalid to REVOKED when communityRoutingStatus is REVOKED', () => {
    expect(normaliseKeyStatus('invalid', 'REVOKED')).toBe('REVOKED');
  });

  it('maps invalid to QUARANTINED when communityRoutingStatus is not REVOKED', () => {
    expect(normaliseKeyStatus('invalid')).toBe('QUARANTINED');
    expect(normaliseKeyStatus('invalid', null)).toBe('QUARANTINED');
    expect(normaliseKeyStatus('invalid', 'SOMETHING_ELSE')).toBe('QUARANTINED');
  });

  it('maps quarantined variants to QUARANTINED', () => {
    expect(normaliseKeyStatus('quarantined')).toBe('QUARANTINED');
    expect(normaliseKeyStatus('QUARANTINED')).toBe('QUARANTINED');
  });

  it('maps exhausted/rate_limited/cooldown variants to COOLDOWN', () => {
    expect(normaliseKeyStatus('exhausted')).toBe('COOLDOWN');
    expect(normaliseKeyStatus('rate_limited')).toBe('COOLDOWN');
    expect(normaliseKeyStatus('COOLDOWN')).toBe('COOLDOWN');
  });

  it('maps revoked to REVOKED', () => {
    expect(normaliseKeyStatus('REVOKED')).toBe('REVOKED');
    expect(normaliseKeyStatus('revoked')).toBe('REVOKED');
  });

  it('fails closed to QUARANTINED for unknown or null values', () => {
    expect(normaliseKeyStatus('some_unknown_value')).toBe('QUARANTINED');
    expect(normaliseKeyStatus(null)).toBe('QUARANTINED');
  });
});

describe('normalisePoolType', () => {
  it('returns PRIVATE for null', () => {
    expect(normalisePoolType(null)).toBe('PRIVATE');
  });

  it('is case-insensitive for community', () => {
    expect(normalisePoolType('community')).toBe('COMMUNITY');
    expect(normalisePoolType('COMMUNITY')).toBe('COMMUNITY');
    expect(normalisePoolType('Community')).toBe('COMMUNITY');
  });

  it('returns PRIVATE for private or unknown values', () => {
    expect(normalisePoolType('private')).toBe('PRIVATE');
    expect(normalisePoolType('PRIVATE')).toBe('PRIVATE');
    expect(normalisePoolType('something_else')).toBe('PRIVATE');
  });
});
