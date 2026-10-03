import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import AddKeyModal from './AddKeyModal.svelte';
import { api } from './api';

const requests: Array<{ turnstile: string | null; body: Record<string, unknown> }> = [];
let reply: () => Response = () => HttpResponse.json({ error: 'key_already_registered' }, { status: 409 });
const server = setupServer(
  http.post('http://localhost/api/keys', async ({ request }) => {
    requests.push({ turnstile: request.headers.get('x-turnstile-token'), body: (await request.json()) as Record<string, unknown> });
    return reply();
  })
);

let issueToken: ((t: string) => void) | null = null;
const resets: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  requests.length = 0;
  resets.length = 0;
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key-test');
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      issueToken = opts.callback;
      return 'widget-1';
    },
    reset: (id: string) => resets.push(id),
    remove: () => {},
  };
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

function type(sel: string, value: string) {
  const input = document.querySelector(sel) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;

describe('AddKeyModal (WP-3.6)', () => {
  it('stays disabled until K1, K2 and a Turnstile token, sends the token as x-turnstile-token, renders the error code as a message', async () => {
    const modal = mount(AddKeyModal, {
      target: document.body,
      props: { isOpen: true, onAddKey: async (p) => void (await api.createKey(p)) },
    });
    await settle();
    type('#key-label', 'my key');
    type('#api-key-input', 'AIza' + 'x'.repeat(35));
    flushSync();

    const [k1, k2] = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    k1.click();
    flushSync();
    expect(submitButton().disabled).toBe(true);
    k2.click();
    flushSync();
    expect(submitButton().disabled).toBe(true);
    issueToken!('turnstile-token-1');
    flushSync();
    expect(submitButton().disabled).toBe(false);

    submitButton().click();
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0].turnstile).toBe('turnstile-token-1');
    expect(requests[0].body).not.toHaveProperty('turnstile_token');
    expect(document.body.textContent).toContain('This key is already registered.');
    expect(resets).toEqual(['widget-1']);
    expect(submitButton().disabled).toBe(true);
    unmount(modal);
  });
});

describe('AddKeyModal layout (WP-F.6, QA-10)', () => {
  it('caps the card at the viewport height and scrolls the form inside it', async () => {
    const modal = mount(AddKeyModal, { target: document.body, props: { isOpen: true } });
    await settle();

    const backdrop = document.querySelector('[role="dialog"]') as HTMLElement;
    const card = backdrop.firstElementChild as HTMLElement;
    const form = card.querySelector('form') as HTMLFormElement;

    expect(backdrop.classList).toContain('items-start');
    expect(backdrop.classList).toContain('sm:items-center');
    expect(backdrop.classList).not.toContain('items-center');
    expect(card.classList).toContain('max-h-[calc(100vh-2rem)]');
    expect(card.classList).toContain('flex');
    expect(card.classList).toContain('flex-col');
    expect(form.classList).toContain('overflow-y-auto');
    expect(form.classList).toContain('min-h-0');
    unmount(modal);
  });
});

describe('AddKeyModal provider selection (WP-F.6, QA-11)', () => {
  it('keeps Groq selected through submit and sends provider "groq"', async () => {
    reply = () => HttpResponse.json({ error: 'key_already_registered' }, { status: 409 });
    const modal = mount(AddKeyModal, {
      target: document.body,
      props: { isOpen: true, onAddKey: async (p) => void (await api.createKey(p)) },
    });
    await settle();

    const groq = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Groq Cloud'))!;
    groq.click();
    flushSync();
    type('#key-label', 'groq key');
    type('#api-key-input', 'gsk_' + 'x'.repeat(52));
    flushSync();
    const [k1, k2] = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    k1.click();
    k2.click();
    issueToken!('turnstile-token-groq');
    flushSync();

    submitButton().click();
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0].body.provider).toBe('groq');
    unmount(modal);
  });
});
