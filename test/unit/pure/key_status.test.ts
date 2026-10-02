import { describe, expect, it } from 'vitest';
import { normaliseKeyStatus, normalisePoolType } from '../../../src/contracts/keys';

describe('normaliseKeyStatus', () => {
  it('returns canonical uppercase KeyStatus values', () => {
    expect(normaliseKeyStatus('HEALTHY')).toBe('HEALTHY');
    expect(normaliseKeyStatus('COOLDOWN')).toBe('COOLDOWN');
    expect(normaliseKeyStatus('QUARANTINED')).toBe('QUARANTINED');
    expect(normaliseKeyStatus('REVOKED')).toBe('REVOKED');
  });

  it('throws on non-canonical or legacy values like Healthy (T-7.4.3)', () => {
    expect(() => normaliseKeyStatus('Healthy')).toThrow();
    expect(() => normaliseKeyStatus('healthy')).toThrow();
    expect(() => normaliseKeyStatus('invalid')).toThrow();
    expect(() => normaliseKeyStatus('exhausted')).toThrow();
    expect(() => normaliseKeyStatus('rate_limited')).toThrow();
    expect(() => normaliseKeyStatus('some_unknown_value')).toThrow();
    expect(() => normaliseKeyStatus(null)).toThrow();
  });
});

describe('normalisePoolType', () => {
  it('returns PRIVATE for null', () => {
    expect(normalisePoolType(null)).toBe('PRIVATE');
  });

  it('returns canonical PoolType values', () => {
    expect(normalisePoolType('COMMUNITY')).toBe('COMMUNITY');
    expect(normalisePoolType('PRIVATE')).toBe('PRIVATE');
  });
});
