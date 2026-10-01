import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import OAuthModal from './OAuthModal.svelte';
import { CONSENT_TEXTS } from './auth/consent_texts';

const consentBodies: unknown[] = [];
const server = setupServer(
  http.post('http://localhost/api/auth/google', () => HttpResponse.json({ next: 'consent' })),
  http.post('http://localhost/api/auth/consent', async ({ request }) => {
    consentBodies.push(await request.json());
    return HttpResponse.json({ success: true, status: 'ACTIVE' });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  document.body.innerHTML = '';
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;

describe('sign-in → consent → dashboard', () => {
  it('keeps consent submit disabled until C1, C2 and C3 are ticked, then signs in', async () => {
    const onSignedIn = vi.fn();
    const onClose = vi.fn();
    const app = mount(OAuthModal, {
      target: document.body,
      props: { isOpen: true, onClose, onSignedIn, getGoogleIdToken: async () => 'firebase-id-token' },
    });

    q<HTMLButtonElement>('[data-testid="google-sign-in"]')!.click();
    await settle();

    const submit = q<HTMLButtonElement>('[data-testid="consent-submit"]');
    expect(submit).not.toBeNull();
    expect(document.body.textContent).toContain(CONSENT_TEXTS.c1);
    expect(document.body.textContent).toContain(CONSENT_TEXTS.c2);
    expect(document.body.textContent).toContain(CONSENT_TEXTS.c3);

    for (const id of ['c1', 'c2'] as const) {
      q<HTMLInputElement>(`[data-testid="consent-${id}"]`)!.click();
      flushSync();
      expect(submit!.disabled).toBe(true);
    }
    q<HTMLInputElement>('[data-testid="consent-c3"]')!.click();
    flushSync();
    expect(submit!.disabled).toBe(false);

    submit!.click();
    await settle();

    expect(consentBodies).toEqual([{ c1: true, c2: true, c3: true }]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    unmount(app);
  });

  it('an ACTIVE account goes straight to the dashboard without the consent screen', async () => {
    server.use(http.post('http://localhost/api/auth/google', () => HttpResponse.json({ success: true })));
    const onSignedIn = vi.fn();
    const app = mount(OAuthModal, {
      target: document.body,
      props: { isOpen: true, onClose: () => {}, onSignedIn, getGoogleIdToken: async () => 'firebase-id-token' },
    });

    q<HTMLButtonElement>('[data-testid="google-sign-in"]')!.click();
    await settle();

    expect(q('[data-testid="consent-submit"]')).toBeNull();
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    unmount(app);
  });
});
