/**
 * Key Collective v4.0 — Upstream Normalizer Unit Tests
 *
 * Invariants tested:
 * - Responses with status >= 400 have error bodies sanitized and content-length header removed.
 * - Secret patterns (sk-*, gsk_*, AIza*, Bearer tokens, GCP project IDs, IP addresses) are redacted with replacement tokens.
 * - Injected headers 'x-kc-request-id', 'x-kc-model-used', 'x-kc-provider' are attached properly.
 * - Responses with status < 400 retain their body and allowed headers without unnecessary transformation.
 * - Zero `any` types.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeUpstreamResponse,
  sanitize,
  createErrorSanitizerTransform,
} from '../../../src/proxy/upstream/normalizer';

describe('normalizeUpstreamResponse', () => {
  it('sanitizes error bodies and deletes content-length when status >= 400', async () => {
    const rawError = JSON.stringify({
      error: 'Upstream key sk-1234567890abcdef1234567890_test rejected by projects/123456789012',
    });
    const upstream = new Response(rawError, {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'content-length': String(rawError.length),
        'x-internal-secret': 'do-not-forward',
        'x-request-id': 'upstream-req-1',
      },
    });

    const normalized = normalizeUpstreamResponse(
      upstream,
      'kc-test-req-001',
      'gpt-4o',
      'openai'
    );

    expect(normalized.status).toBe(403);
    expect(normalized.headers.get('content-length')).toBeNull();
    expect(normalized.headers.get('x-internal-secret')).toBeNull();
    expect(normalized.headers.get('content-type')).toBe('application/json');
    expect(normalized.headers.get('x-request-id')).toBe('upstream-req-1');

    const bodyText = await normalized.text();
    expect(bodyText).toContain('[REDACTED_SECRET]');
    expect(bodyText).toContain('[PROJECT_REDACTED]');
    expect(bodyText).not.toContain('sk-1234567890abcdef1234567890_test');
    expect(bodyText).not.toContain('projects/123456789012');
  });

  it('handles null body gracefully for status >= 400', async () => {
    const upstream = new Response(null, {
      status: 404,
      headers: { 'x-request-id': 'req-404' },
    });

    const normalized = normalizeUpstreamResponse(upstream, 'kc-req-404');
    expect(normalized.status).toBe(404);
    expect(normalized.body).toBeNull();
    expect(normalized.headers.get('x-kc-request-id')).toBe('kc-req-404');
  });

  it('attaches injected headers x-kc-request-id, x-kc-model-used, and x-kc-provider properly', () => {
    const upstream = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const normalized = normalizeUpstreamResponse(
      upstream,
      'kc-trace-id-abc',
      'claude-3-5-sonnet',
      'anthropic'
    );

    expect(normalized.headers.get('x-kc-request-id')).toBe('kc-trace-id-abc');
    expect(normalized.headers.get('x-kc-model-used')).toBe('claude-3-5-sonnet');
    expect(normalized.headers.get('x-kc-provider')).toBe('anthropic');
  });

  it('omits optional x-kc-* headers when not provided', () => {
    const upstream = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const normalized = normalizeUpstreamResponse(upstream, 'kc-trace-only');

    expect(normalized.headers.get('x-kc-request-id')).toBe('kc-trace-only');
    expect(normalized.headers.get('x-kc-model-used')).toBeNull();
    expect(normalized.headers.get('x-kc-provider')).toBeNull();
  });

  it('retains body and allowed headers without unnecessary transformation when status < 400', async () => {
    const payload = JSON.stringify({
      choices: [{ text: 'Here is an example reference: projects/12345678' }],
    });
    const upstream = new Response(payload, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
        'cache-control': 'no-cache',
        'x-secret-upstream': 'forbidden',
      },
    });

    const normalized = normalizeUpstreamResponse(upstream, 'kc-success-req');

    expect(normalized.status).toBe(200);
    expect(normalized.headers.get('content-length')).toBe(String(payload.length));
    expect(normalized.headers.get('cache-control')).toBe('no-cache');
    expect(normalized.headers.get('content-type')).toBe('application/json');
    expect(normalized.headers.get('x-secret-upstream')).toBeNull();

    const bodyText = await normalized.text();
    expect(bodyText).toBe(payload);
  });
});

describe('sanitize', () => {
  it('redacts sk-* OpenAI/Anthropic secret keys', () => {
    const input = 'Error with sk-1234567890abcdef1234567890_secretKey in request';
    const output = sanitize(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain('sk-1234567890abcdef1234567890_secretKey');
  });

  it('redacts gsk_* Groq secret keys', () => {
    const input = 'Failed key gsk_abcdef12345678901234567890 supplied';
    const output = sanitize(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain('gsk_abcdef12345678901234567890');
  });

  it('redacts AIza* Google API keys', () => {
    const key = 'AIza' + 'a'.repeat(35);
    const input = `API key ${key} is invalid`;
    const output = sanitize(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain(key);
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer mySecretTokenValue1234567890';
    const output = sanitize(input);
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toContain('mySecretTokenValue1234567890');
  });

  it('redacts GCP project IDs', () => {
    const input = 'Resource not found at projects/987654321012/models';
    const output = sanitize(input);
    expect(output).toContain('[PROJECT_REDACTED]');
    expect(output).not.toContain('projects/987654321012');
  });

  it('redacts IP addresses', () => {
    const input = 'Connection refused from 192.168.1.100:8080 to 10.0.0.1';
    const output = sanitize(input);
    expect(output).toContain('[REDACTED_IP]');
    expect(output).not.toContain('192.168.1.100');
    expect(output).not.toContain('10.0.0.1');
  });

  it('handles empty and falsy input safely', () => {
    expect(sanitize('')).toBe('');
  });
});

describe('createErrorSanitizerTransform', () => {
  it('creates a TransformStream that sanitizes error chunks', async () => {
    const transform = createErrorSanitizerTransform();
    const inputChunk = 'Access denied: projects/123456789012 and sk-abcdef1234567890123456';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(inputChunk));
        controller.close();
      },
    });

    const transformed = stream.pipeThrough(transform);
    const response = new Response(transformed);
    const text = await response.text();

    expect(text).toBe('Access denied: [PROJECT_REDACTED] and [REDACTED_SECRET]');
  });
});
