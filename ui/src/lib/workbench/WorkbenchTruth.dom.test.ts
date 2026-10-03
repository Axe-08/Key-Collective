import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { UserAccount } from '../../../../src/contracts/v3_types';
import Workbench from '../Workbench.svelte';

// WP-F.7: the Workbench shows only what the server knows.
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const server = setupServer(
  http.get('http://localhost/api/projects', () => HttpResponse.json([])),
  http.get('http://localhost/api/tokens', () => HttpResponse.json([])),
  http.get('http://localhost/api/keys', () => HttpResponse.json([])),
  http.all('http://localhost/*', () => HttpResponse.json({}))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  document.body.innerHTML = '';
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

const account: UserAccount = {
  id: 'usr_1',
  githubId: 0,
  githubUsername: 'dev',
  primaryEmail: '',
  tier: 'builder',
  avatarUrl: '',
  isEmailVerified: false,
  githubCreatedAt: '',
  sybilScore: 0,
  registrationIp: '',
  createdAt: '',
  updatedAt: '',
  authProvider: 'github',
};

describe('T-F.7.2 no invented telemetry in the Workbench (QA-05)', () => {
  it('shows no invented cluster or status ticker, and the print action is called Print view', async () => {
    const wb = mount(Workbench, { target: document.body, props: { userAccount: account } });
    await settle();

    const text = document.body.textContent ?? '';
    for (const invented of ['iad-edge-01', 'NOMINAL', 'Latency Nominal', 'Verified (Web Crypto)', '2024-11-14', 'PDF Audit Dossier']) {
      expect(text.includes(invented), invented).toBe(false);
    }
    const exportBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Export Workspace'));
    exportBtn?.click();
    flushSync();
    const labels = Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(labels.some((l) => l.endsWith('Print view'))).toBe(true);
    unmount(wb);
  });
});

describe('T-F.7.3 a key whose project is unknown names no invented project (QA-13)', () => {
  it('shows an em dash, never Production Gateway', async () => {
    server.use(
      http.get('http://localhost/api/tokens', () =>
        HttpResponse.json([{ id: 'tok_x1', project_id: 'prj_gone', hash_masked: 'abcd…wxyz', created_at: '2026-01-01T00:00:00Z' }])
      )
    );
    const wb = mount(Workbench, { target: document.body, props: { userAccount: account } });
    await settle();

    expect(document.body.textContent?.includes('Production Gateway')).toBe(false);
    expect(document.body.textContent).toContain('—');
    unmount(wb);
  });
});

describe('T-F.7.1 tier cards are read-only (QA-04)', () => {
  it('renders tier cards without buttons, and clicking one does not change the active tier', async () => {
    const wb = mount(Workbench, { target: document.body, props: { userAccount: account } });
    await settle();

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="tier-card"]'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.tagName).not.toBe('BUTTON');
      expect(card.closest('button')).toBeNull();
    }
    const probationary = cards.find((c) => c.textContent?.includes('Probationary'));
    probationary?.click();
    flushSync();
    const active = cards.filter((c) => c.textContent?.includes('CURRENT ACTIVE TIER'));
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain('Builder');
    unmount(wb);
  });

  it('App has no client-side tier switch or its toast', () => {
    const app = src('../../App.svelte');
    expect(app.includes('handleSelectTier')).toBe(false);
    expect(app.includes('Authorization Tier updated')).toBe(false);
    expect(src('../Workbench.svelte').includes('onSelectTier')).toBe(false);
  });
});
