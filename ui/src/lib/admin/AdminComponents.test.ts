import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import TenantsView from './TenantsView.svelte';
import KeysView from './KeysView.svelte';
import ProvidersView from './ProvidersView.svelte';
import AuditLogView from './AuditLogView.svelte';
import type { TenantSurveillanceRow, TenantKeySurveillanceItem } from '../../../../src/contracts/v3_5_types';

describe('WP-6.2: Admin UI Components (T-6.2.4 - T-6.2.7)', () => {
  const sampleTenants: TenantSurveillanceRow[] = [
    {
      id: 'usr_t1',
      tenantId: 'usr_t1',
      email: 'builder1@test.com',
      tier: 'builder',
      role: 'user',
      authProvider: 'github',
      sybilScore: 85,
      isQuarantined: false,
      communityDebtCu: 500,
      todaySpendCu: 1200,
      activeKeyCount: 2,
      currentRpm: 15,
      rpmLimit: 20,
      lastActiveTimestamp: Date.now(),
      created_at: new Date().toISOString(),
      keys: [],
    },
  ];

  const sampleKeys: TenantKeySurveillanceItem[] = [
    {
      id: 'key_123',
      tenant_id: 'usr_t1',
      label: 'Main Key',
      provider: 'gemini',
      key_prefix: 'AIzaSy',
      key_suffix: 'XYZ',
      rpm_limit: 60,
      rpd_limit: 1500,
      priority: 0,
      status: 'healthy',
      pool_type: 'COMMUNITY',
      community_routing_status: 'ACTIVE',
      observation_until: null,
      dispatches_today: 45,
      dispatches_communal: 20,
      created_at: Date.now(),
    },
  ];

  it('T-6.2.4: TenantsView renders tenant rows and has reset quota action', () => {
    const result = render(TenantsView, {
      props: { tenants: sampleTenants },
    });
    expect(result.body).toContain('usr_t1');
    expect(result.body).toContain('builder1@test.com');
    expect(result.body).toContain('500 CU');
    expect(result.body).toContain('Reset Quota');
  });

  it('T-6.2.5: KeysView renders keys and routing status controls', () => {
    const result = render(KeysView, {
      props: { keys: sampleKeys },
    });
    expect(result.body).toContain('Main Key');
    expect(result.body).toContain('ACTIVE');
    expect(result.body).toContain('COMMUNITY');
    expect(result.body).toContain('45 today');
  });

  it('T-6.2.6: ProvidersView renders provider cards with override toggles', () => {
    const circuits = {
      gemini: { state: 'NORMAL' as const, failureCount: 0, failureThreshold: 5, lastTrippedAt: null, avgLatencyMs: 45 },
      groq: { state: 'TRIPPED' as const, failureCount: 5, failureThreshold: 5, lastTrippedAt: Date.now(), avgLatencyMs: 0 },
      cerebras: { state: 'NORMAL' as const, failureCount: 0, failureThreshold: 5, lastTrippedAt: null, avgLatencyMs: 25 },
      deepseek: { state: 'NORMAL' as const, failureCount: 0, failureThreshold: 5, lastTrippedAt: null, avgLatencyMs: 80 },
    };
    const result = render(ProvidersView, {
      props: { circuits },
    });
    expect(result.body).toContain('Google Gemini Flash');
    expect(result.body).toContain('Groq Cloud');
    expect(result.body).toContain('TRIPPED');
    expect(result.body).toContain('Reset to NORMAL');
    expect(result.body).toContain('Trip Circuit Override');
  });

  it('T-6.2.7: AuditLogView renders table headers', () => {
    const result = render(AuditLogView, {});
    expect(result.body).toContain('Timestamp');
    expect(result.body).toContain('Actor');
    expect(result.body).toContain('Action');
    expect(result.body).toContain('Target');
  });
});
