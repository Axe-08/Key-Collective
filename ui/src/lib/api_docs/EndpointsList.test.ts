import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import EndpointsList from './EndpointsList.svelte';
import { specToMarkdown, type OpenApiDocument } from './generators';

const spec: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'Key Collective API', version: '1' },
  paths: {
    '/chat/completions': { post: { summary: 'Create a chat completion' } },
    '/models': { get: { summary: 'List models' } },
    '/health': { get: { summary: 'Health' } },
    '/openapi.json': { get: { summary: 'This document' } },
  },
};

function renderedPaths(html: string): string[] {
  return [...html.matchAll(/data-testid="endpoint-path"[^>]*>([^<]+)</g)].map((m) => m[1]);
}

describe('API docs endpoints (WP-3.10)', () => {
  it('lists exactly the OpenAPI paths', () => {
    const { body } = render(EndpointsList, { props: { spec, baseUrl: 'https://api.test/v1' } });

    expect(renderedPaths(body).sort()).toEqual(Object.keys(spec.paths).sort());
    expect(body).not.toContain('/v1/projects');
    expect(body).not.toContain('/v1/telemetry');
  });

  it('shows a loading note, not invented endpoints, before the spec arrives', () => {
    const { body } = render(EndpointsList, { props: { spec: null, baseUrl: 'https://api.test/v1' } });

    expect(renderedPaths(body)).toEqual([]);
    expect(body).toContain('endpoints-loading');
  });

  it('exports Markdown from the same spec', () => {
    const md = specToMarkdown(spec, 'https://api.test/v1');

    expect(md).toContain('## POST `/chat/completions`');
    expect(md).toContain('## GET `/models`');
    expect(md).not.toContain('/v1/projects');
  });
});
