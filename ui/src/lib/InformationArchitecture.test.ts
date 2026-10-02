import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import SideNavBar from './SideNavBar.svelte';
import TopNavBar from './TopNavBar.svelte';
import DashboardView from './DashboardView.svelte';
import KeysView from './KeysView.svelte';
import RotateKeyModal from './RotateKeyModal.svelte';
import PoolToggleModal from './PoolToggleModal.svelte';
import PoolView from './PoolView.svelte';
import AnalyticsView from './AnalyticsView.svelte';
import ReportPage from './ReportPage.svelte';
import NotificationToasts from './NotificationToasts.svelte';
import type { PoolStats, APIKey } from './types';
import type { UserAccount } from '../../../src/contracts/v3_types';

const mockStats: PoolStats = {
  total_keys: 2,
  healthy_keys: 2,
  rate_limited_keys: 0,
  invalid_keys: 0,
  total_rpm_headroom: 30,
  total_rpm_limit: 30,
  current_rpm_used: 0,
  avg_upstream_latency_ms: 120,
  daily_quota_used: 100,
  daily_quota_limit: 1000,
  proxy_status: 'healthy',
  cu_used_today: 50,
  cu_allowance_today: 500,
};

const mockUser: UserAccount = {
  id: 'usr_1',
  githubId: 12345,
  githubUsername: 'dev-user',
  primaryEmail: 'dev@example.com',
  tier: 'builder',
  avatarUrl: '',
  isEmailVerified: true,
  githubCreatedAt: '2024-01-01',
  sybilScore: 85,
  registrationIp: '127.0.0.1',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const mockKeys: APIKey[] = [
  {
    id: 'key_1',
    key_prefix: 'AIzaSy12',
    key_suffix: 'abcd',
    provider: 'gemini',
    label: 'Primary Gemini Key',
    rpm_limit: 15,
    rpd_limit: 1500,
    priority: 1,
    status: 'healthy',
    pool_type: 'COMMUNITY',
    community_routing_status: 'OBSERVATION',
    observation_until: new Date(Date.now() + 3600_000).toISOString(),
  },
  {
    id: 'key_2',
    key_prefix: 'gsk_9876',
    key_suffix: 'wxyz',
    provider: 'groq',
    label: 'Private Groq Key',
    rpm_limit: 30,
    rpd_limit: 14400,
    priority: 1,
    status: 'healthy',
    pool_type: 'PRIVATE',
  },
];

describe('WP-6.4: Information Architecture per PRD Section 4', () => {
  it('T-6.4.1: SideNavBar and TopNavBar render Dashboard, Keys, Pool, Analytics and Developers menu', () => {
    const sideRes = render(SideNavBar, {
      props: {
        activeTab: 'dashboard',
        stats: mockStats,
        keys: mockKeys,
        userAccount: mockUser,
      },
    });
    expect(sideRes.body).toContain('Dashboard');
    expect(sideRes.body).toContain('Keys');
    expect(sideRes.body).toContain('Pool');
    expect(sideRes.body).toContain('Analytics');
    expect(sideRes.body).toContain('Developers');
    expect(sideRes.body).toContain('Playground');
    expect(sideRes.body).toContain('API Documentation');

    const topRes = render(TopNavBar, {
      props: {
        activeTab: 'dashboard',
        stats: mockStats,
        userAccount: mockUser,
      },
    });
    expect(topRes.body).toContain('Dashboard');
    expect(topRes.body).toContain('Keys');
    expect(topRes.body).toContain('Pool');
    expect(topRes.body).toContain('Analytics');
    expect(topRes.body).toContain('Developers');
  });

  it('T-6.4.2: DashboardView renders StandingCard, activity metrics, and gateway endpoint', () => {
    const res = render(DashboardView, {
      props: {
        stats: mockStats,
        keys: mockKeys,
        proxyEndpoint: 'https://api.key-col.axe08.tech/v1/chat/completions',
        userAccount: mockUser,
        projects: [],
        projectKeys: [],
      },
    });
    expect(res.body).toContain('Dashboard &amp; Standing Overview');
    expect(res.body).toContain('Personal Reqs');
    expect(res.body).toContain('Communal Served');
    expect(res.body).toContain('https://api.key-col.axe08.tech/v1/chat/completions');
  });

  it('T-6.4.3: KeysView renders sub-tabs My Keys, Private, Observation', () => {
    const res = render(KeysView, {
      props: {
        keys: mockKeys,
      },
    });
    expect(res.body).toContain('My Keys');
    expect(res.body).toContain('Private');
    expect(res.body).toContain('Observation');
    expect(res.body).toContain('Primary Gemini Key');
    expect(res.body).toContain('Private Groq Key');
  });

  it('T-6.4.4: RotateKeyModal and PoolToggleModal render PRD Flow D and Flow E notices', () => {
    const rotateRes = render(RotateKeyModal, {
      props: {
        isOpen: true,
        keyId: 'key_1',
        provider: 'google',
        onClose: () => {},
      },
    });
    expect(rotateRes.body).toContain('30-Minute Zero-Loss Rotation Window');
    expect(rotateRes.body).toContain('Confirm Rotation');

    const toggleRes = render(PoolToggleModal, {
      props: {
        isOpen: true,
        keyId: 'key_1',
        currentPoolType: 'PRIVATE',
        onClose: () => {},
      },
    });
    expect(toggleRes.body).toContain('24-Hour Observation &amp; Verification Window');
    expect(toggleRes.body).toContain('23:30 and 00:30 UTC');
  });

  it('T-6.4.5: PoolView renders Community, Provider, My Contribution sub-tabs and locked CTA when communityPool is false', () => {
    const unlockedRes = render(PoolView, {
      props: {
        communityPool: true,
      },
    });
    expect(unlockedRes.body).toContain('Community');
    expect(unlockedRes.body).toContain('Provider');
    expect(unlockedRes.body).toContain('My Contribution');

    const lockedRes = render(PoolView, {
      props: {
        communityPool: false,
      },
    });
    expect(lockedRes.body).toContain('Link GitHub to Join the Community Pool');
  });

  it('T-6.4.6: AnalyticsView renders Usage, Usage Ledger, and Multiplier History sub-tabs', () => {
    const res = render(AnalyticsView);
    expect(res.body).toContain('Usage');
    expect(res.body).toContain('Usage Ledger');
    expect(res.body).toContain('Multiplier History');
  });

  it('T-6.4.7: ReportPage renders unauthenticated compromised key takedown form', () => {
    const res = render(ReportPage);
    expect(res.body).toContain('Public Compromised Key Takedown');
    expect(res.body).toContain('Zero-Knowledge Verification');
    expect(res.body).toContain('Submit Takedown');
  });

  it('T-6.4.8: NotificationToasts mounts cleanly', () => {
    const res = render(NotificationToasts);
    expect(res).toBeDefined();
  });
});
