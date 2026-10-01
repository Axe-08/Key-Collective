import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import Workbench from '../Workbench.svelte';

// A tiny in-memory server: projects and API keys as the real routes return them.
interface Proj { id: string; name: string; rpm_sub_cap: number | null; is_archived: number }
let projects: Proj[] = [];
let tokens: Array<{ id: string; project_id: string; secret: string }> = [];
const TIER_MAX = 20;

const server = setupServer(
  http.get('http://localhost/api/projects', () => HttpResponse.json(projects)),
  http.patch('http://localhost/api/projects/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<{ rpm_sub_cap: number; is_archived: boolean }>;
    if (typeof body.rpm_sub_cap === 'number' && body.rpm_sub_cap > TIER_MAX) {
      return HttpResponse.json(
        { error: { message: `RPM sub-cap exceeds your tier maximum of ${TIER_MAX}`, code: 'SUB_CAP_ABOVE_TIER' } },
        { status: 400 }
      );
    }
    const p = projects.find((x) => x.id === params.id)!;
    if (body.rpm_sub_cap !== undefined) p.rpm_sub_cap = body.rpm_sub_cap;
    if (body.is_archived !== undefined) p.is_archived = body.is_archived ? 1 : 0;
    return HttpResponse.json({ ...p, is_archived: p.is_archived === 1 });
  }),
  http.get('http://localhost/api/tokens', () =>
    HttpResponse.json(tokens.map((t) => ({ id: t.id, project_id: t.project_id, hash_masked: 'abcd…wxyz', created_at: '2026-01-01T00:00:00Z' })))
  ),
  http.post('http://localhost/api/tokens/:id/rotate', ({ params }) => {
    const t = tokens.find((x) => x.id === params.id)!;
    t.secret = `kc_proj_live_rotated_${Math.random().toString(36).slice(2)}`;
    return HttpResponse.json({ id: t.id, project_id: t.project_id, token: t.secret, hash_masked: 'new…hash' });
  }),
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

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;

function seed() {
  projects = [{ id: 'prj_a', name: 'Alpha', rpm_sub_cap: 5, is_archived: 0 }];
  tokens = [{ id: 'tok_a', project_id: 'prj_a', secret: 'kc_proj_live_original' }];
}

describe('Workbench projects and API keys (WP-3.9)', () => {
  it('shows the real sub-cap; rotate shows the new secret once and retires the old one', async () => {
    seed();
    const wb = mount(Workbench, { target: document.body, props: {} });
    await settle();

    expect(q('[data-testid="project-rpm"]')?.textContent).toContain('/ 5 RPM');
    const old = tokens[0].secret;
    q<HTMLButtonElement>('[data-testid="project-rotate-prj_a"]')!.click();
    await settle();

    expect(q('[data-testid="secret-value"]')?.textContent).toBe(tokens[0].secret);
    expect(tokens[0].secret).not.toBe(old);
    q<HTMLButtonElement>('[data-testid="secret-done"]')!.click();
    flushSync();
    expect(q('[data-testid="secret-value"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(tokens[0].secret);
    unmount(wb);
  });

  it('archives only after the server answers, and the archive survives a reload', async () => {
    seed();
    const wb = mount(Workbench, { target: document.body, props: {} });
    await settle();

    q<HTMLButtonElement>('[data-testid="project-settings-prj_a"]')!.click();
    flushSync();
    q<HTMLButtonElement>('[data-testid="project-archive-toggle"]')!.click();
    await settle();
    expect(projects[0].is_archived).toBe(1);
    unmount(wb);

    const reloaded = mount(Workbench, { target: document.body, props: {} });
    await settle();
    q<HTMLButtonElement>('[data-testid="project-settings-prj_a"]')!.click();
    flushSync();
    expect(document.body.textContent).toMatch(/archived/i);
    unmount(reloaded);
  });

  it('a sub-cap above the tier maximum shows the server 400 inline and keeps the old value', async () => {
    seed();
    const wb = mount(Workbench, { target: document.body, props: {} });
    await settle();

    q<HTMLButtonElement>('[data-testid="project-settings-prj_a"]')!.click();
    flushSync();
    const input = q<HTMLInputElement>('[data-testid="project-rpm-input"]')!;
    input.value = '999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    await settle();

    expect(q('[data-testid="project-settings-error"]')?.textContent).toContain('tier maximum of 20');
    expect(projects[0].rpm_sub_cap).toBe(5);
    expect(q('[data-testid="project-rpm"]')?.textContent).toContain('/ 5 RPM');
    unmount(wb);
  });
});
