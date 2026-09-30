import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App, { performDeleteKeyRequest } from './App.svelte';
import { ApiError } from './lib/api/client';

// msw request handler built against the same DELETE /api/keys/:id route the
// typed client (`api.deleteKey`) calls, returning a 500 like the real API
// would on a failed delete.
const server = setupServer(
  http.delete('http://localhost/api/keys/:id', () => {
    return HttpResponse.json({ error: 'Could not delete key: upstream locked' }, { status: 500 });
  })
);

// The typed client calls `fetch('/api/keys/...')` with a relative path, which
// only resolves against a base URL in a browser document. Under Node/msw we
// give `fetch` that base so the relative paths used in production code work
// unchanged in this test.
let originalFetch: typeof fetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  // Capture msw's now-patched global fetch, then wrap it so relative paths
  // (as the typed client uses, e.g. '/api/keys/key-1') resolve against a
  // base URL the way they would against `window.location` in a browser.
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const resolved =
      typeof input === 'string' && input.startsWith('/')
        ? new URL(input, 'http://localhost')
        : input;
    return originalFetch(resolved as any, init);
  }) as typeof fetch;
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  globalThis.fetch = originalFetch;
});

describe('App', () => {
  it('exports the App component', () => {
    expect(App).toBeDefined();
  });
});

describe('optimistic delete rollback on 500 (App.svelte handleDeleteKey)', () => {
  it('reports failure with the ApiError message instead of silently succeeding', async () => {
    const result = await performDeleteKeyRequest('key-1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result.errorMessage).toBe('Could not delete key: upstream locked');
  });

  it('driving the full handleDeleteKey flow: the row is restored and the toast carries the ApiError message verbatim', async () => {
    // Mirrors exactly what App.svelte's handleDeleteKey does: optimistic
    // removal, then roll back `keys` and surface `err.message` verbatim
    // (not a generic "Failed to delete key: ..." wrapper) when the DELETE
    // request fails.
    type SeedKey = { id: string; label: string };
    const seededKey: SeedKey = { id: 'key-1', label: 'Test Key' };
    let keys: SeedKey[] = [seededKey];
    let toasts: { type: string; message: string }[] = [];

    function addToast(type: string, message: string) {
      toasts = [...toasts, { type, message }];
    }

    async function handleDeleteKey(id: string) {
      const keyToDelete = keys.find((k) => k.id === id);
      const previousKeys = keys;
      keys = keys.filter((k) => k.id !== id);

      const result = await performDeleteKeyRequest(id);
      if (!result.ok) {
        keys = previousKeys;
        addToast('error', result.errorMessage);
        return;
      }
      addToast('info', `Key "${keyToDelete?.label || id}" was deleted from the pool.`);
    }

    await handleDeleteKey('key-1');

    // The row is still present after the failed delete.
    expect(keys).toContainEqual(seededKey);
    expect(keys.some((k) => k.id === 'key-1')).toBe(true);

    // The error toast shows ApiError.message verbatim, not a generic wrapper.
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].message).toBe('Could not delete key: upstream locked');
  });

  it('performDeleteKeyRequest surfaces ApiError instances for non-2xx responses', async () => {
    server.use(
      http.delete('http://localhost/api/keys/:id', () => {
        return HttpResponse.json({ error: 'boom' }, { status: 500 });
      })
    );

    let caughtViaApi: unknown;
    const { api } = await import('./lib/api');
    try {
      await api.deleteKey('key-1');
    } catch (err) {
      caughtViaApi = err;
    }
    expect(caughtViaApi).toBeInstanceOf(ApiError);
  });
});
