import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Playground from './Playground.svelte';
import ApiDocs from './ApiDocs.svelte';

// T-F.3.5: the Playground, API docs and pricing table list exactly the models /v1/models returns.

const MODELS = [
  { id: 'fixture-model-a', owned_by: 'google', kc: { cu_base: 5, cu_in_per_1k: 1, cu_cached_per_1k: 0, cu_out_per_1k: 2 } },
  { id: 'fixture-model-b', owned_by: 'groq', kc: { cu_base: 5, cu_in_per_1k: 1, cu_cached_per_1k: 0, cu_out_per_1k: 1 } },
];
const IDS = MODELS.map((m) => m.id);

const sentModels: string[] = [];

const server = setupServer(
  http.post('http://localhost/api/playground/token', () =>
    HttpResponse.json({ token: 'kc_live_playground', expires_at: new Date(Date.now() + 900_000).toISOString() }, { status: 201 })
  ),
  http.get('http://localhost/v1/models', () => HttpResponse.json({ object: 'list', data: MODELS })),
  http.get('http://localhost/v1/openapi.json', () => HttpResponse.json({ openapi: '3.0.0', paths: {} })),
  http.post('http://localhost/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as { model?: string };
    sentModels.push(String(body.model));
    return new HttpResponse('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  document.body.innerHTML = '';
  sentModels.length = 0;
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

function optionValues(selector: string): string[] {
  return [...document.querySelectorAll(`${selector} option`)].map((o) => (o as HTMLOptionElement).value);
}

describe('Model pickers read /v1/models only (T-F.3.5)', () => {
  it('Playground offers exactly the /v1/models models and sends the selected one', async () => {
    const pg = mount(Playground, { target: document.body, props: { proxyEndpoint: 'http://localhost/v1/chat/completions' } });
    await settle();

    expect(optionValues('#playModel')).toEqual(IDS);
    (document.querySelector('[data-testid="playground-send"]') as HTMLButtonElement).click();
    await settle();
    expect(sentModels).toEqual(['fixture-model-a']);
    expect(document.body.textContent).not.toMatch(/gemini-|llama-|gpt-oss|qwen/);
    unmount(pg);
  });

  it('API docs picker and pricing table show exactly the /v1/models models', async () => {
    const docs = mount(ApiDocs, { target: document.body, props: { proxyEndpoint: 'http://localhost/v1/chat/completions' } });
    await settle();

    expect(optionValues('#modelSelect')).toEqual(IDS);
    const rows = [...document.querySelectorAll('table tbody tr')].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('fixture-model-a');
    expect(rows[1]).toContain('fixture-model-b');
    expect(document.body.textContent).not.toMatch(/gemini-|llama-|gpt-oss|qwen/);
    unmount(docs);
  });

  it('the picker components hard-code no model id', () => {
    const files = [
      'Playground.svelte',
      'ApiDocs.svelte',
      'api_docs/CodePlayground.svelte',
      'api_docs/PricingTable.svelte',
      'playground/PlaygroundRequestForm.svelte',
      'playground/PlaygroundSnippets.svelte',
      'playground/PlaygroundResponseStream.svelte',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), 'utf-8');
      expect(src, f).not.toMatch(/['"`](gemini-[\w.-]+|llama[\w.-]*|openai\/gpt-oss[\w.-]*|qwen\/[\w.-]+)['"`]/);
      expect(src, f).not.toMatch(/"model":\s*"[a-z]/);
    }
  });
});
