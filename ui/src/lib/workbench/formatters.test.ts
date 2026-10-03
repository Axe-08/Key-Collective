import { describe, expect, it } from 'vitest';
import type { UserAccount } from '../../../../src/contracts/v3_types';
import { TIER_LIMITS_MAP } from '../../../../src/contracts/v3_types';
import { generateMarkdownExport } from './formatters';
import type { ExtendedKey, ExtendedProject } from './types';

const account: UserAccount = {
  id: 'usr_1',
  githubId: 0,
  githubUsername: 'dev',
  primaryEmail: 'dev@example.test',
  tier: 'builder',
  avatarUrl: '',
  isEmailVerified: false,
  githubCreatedAt: '',
  sybilScore: 40,
  registrationIp: '',
  createdAt: '',
  updatedAt: '',
};

const key: ExtendedKey = {
  id: 'tok_1',
  projectId: '',
  tenantId: 'usr_1',
  name: 'API key …abc123',
  tokenPrefix: 'abcd',
  tokenHashSha256: 'abcd…wxyz',
  isRevoked: false,
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('T-F.7.2 Markdown export carries only real data (QA-05)', () => {
  it('has no invented cluster, region, ASN, verification or repository telemetry', () => {
    const projects: ExtendedProject[] = [];
    const md = generateMarkdownExport(account, 'builder', TIER_LIMITS_MAP.builder, projects, [key]);
    for (const invented of [
      'iad-edge-01',
      'Singapore',
      'ASN',
      'Turnstile Biometrics',
      '0.01ms',
      '432d',
      '14 months',
      '18 Repos',
      '420+ commits',
      'Flagged Spikes',
      'Low Risk',
      'Verified: No',
      'Production Gateway',
    ]) {
      expect(md.includes(invented), invented).toBe(false);
    }
    expect(md).toContain('`usr_1`');
    expect(md).toContain('BUILDER');
    expect(md).toContain('| — |');
  });
});
