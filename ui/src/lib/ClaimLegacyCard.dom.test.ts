import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import ClaimLegacyCard from './ClaimLegacyCard.svelte';
import { setCsrfToken } from './api/client';

const seen: Array<{ csrf: string | null }> = [];
const server = setupServer(
  http.post('http://localhost/api/auth/claim-legacy', ({ request }) => {
    seen.push({ csrf: request.headers.get('x-kc-csrf') });
    return HttpResponse.json({ success: true, claimed_accounts: ['gh_123'], claimed_keys: 2 });
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

describe('ClaimLegacyCard', () => {
  it('claims the old keys with the CSRF header and reports success', async () => {
    setCsrfToken('csrf-claim');
    const onClaimed = vi.fn();
    const card = mount(ClaimLegacyCard, { target: document.body, props: { accounts: ['gh_123'], onClaimed } });

    expect(document.body.textContent).toContain('Claim your old keys');
    expect(document.body.textContent).toContain('gh_123');
    (document.querySelector('[data-testid="claim-legacy"]') as HTMLButtonElement).click();
    await settle();

    expect(seen).toEqual([{ csrf: 'csrf-claim' }]);
    expect(document.body.textContent).toContain('2 keys moved');
    expect(onClaimed).toHaveBeenCalledTimes(1);
    unmount(card);
  });
});
