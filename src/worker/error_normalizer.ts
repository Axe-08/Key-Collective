/**
 * Key Collective v4.0 — Downstream Error Normalizer & Header Sanitizer (FR-10, IR-12)
 * Allow-list response headers policy — only explicitly listed headers forwarded.
 */

export const ALLOWED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type', 'content-length', 'cache-control',
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-request-id',
  'x-kc-request-id', 'x-kc-model-used', 'x-kc-provider', 'x-kc-trace-id', 'x-kc-commons-notice',
  'transfer-encoding', 'content-encoding',
]);

export const GCP_PROJECT_PATTERN = /projects\/\d{6,}/gi;
export const BILLING_ACCOUNT_PATTERN = /billingAccounts\/[A-Z0-9-]+/gi;
export const CLOUD_TRACE_PATTERN = /\b[0-9a-f]{32}\/\d+\b/gi;
export const CONSUMER_PATTERN = /"consumer"\s*:\s*"[^"]+"/g;
export const QUERY_KEY_PATTERN = /key=[^&\s"]+/g;
export const AIZA_KEY_PATTERN = /AIza[0-9A-Za-z_\-]{35}/g;
export const GSK_KEY_PATTERN = /gsk_[A-Za-z0-9]{20,}/g;
export const SK_KEY_PATTERN = /sk-[A-Za-z0-9_\-]{20,}/g;
export const BEARER_PATTERN = /Bearer\s+\S+/g;
export const SECRET_REGEX = /(sk-[a-zA-Z0-9_\-]{20,}|gsk_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_\-]{35}|Bearer\s+\S+)/g;
export const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function sanitizeResponseHeaders(upstreamHeaders: Headers): Headers {
  const clean = new Headers();
  for (const [key, value] of upstreamHeaders.entries()) {
    if (ALLOWED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      clean.set(key, value);
    }
  }
  return clean;
}

export function sanitize(text: string): string {
  if (typeof text !== "string" || !text) {
    return "";
  }
  return text
    .replace(CONSUMER_PATTERN, '"consumer": "[REDACTED]"')
    .replace(GCP_PROJECT_PATTERN, '[PROJECT_REDACTED]')
    .replace(BILLING_ACCOUNT_PATTERN, '[BILLING_REDACTED]')
    .replace(CLOUD_TRACE_PATTERN, '[TRACE_REDACTED]')
    .replace(QUERY_KEY_PATTERN, 'key=[REDACTED_SECRET]')
    .replace(AIZA_KEY_PATTERN, '[REDACTED_SECRET]')
    .replace(GSK_KEY_PATTERN, '[REDACTED_SECRET]')
    .replace(SK_KEY_PATTERN, '[REDACTED_SECRET]')
    .replace(BEARER_PATTERN, '[REDACTED_SECRET]')
    .replace(IP_REGEX, '[REDACTED_IP]');
}

export function sanitizeErrorBody(raw: string): string {
  return sanitize(raw);
}

export function createErrorSanitizerTransform(): TransformStream<Uint8Array | string, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new TransformStream<Uint8Array | string, Uint8Array>({
    transform(chunk: Uint8Array | string, controller: TransformStreamDefaultController<Uint8Array>) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const sanitized = sanitize(text);
      controller.enqueue(encoder.encode(sanitized));
    },
    flush(controller: TransformStreamDefaultController<Uint8Array>) {
      const remaining = decoder.decode();
      if (remaining) {
        controller.enqueue(encoder.encode(sanitize(remaining)));
      }
    },
  });
}

export function normalizeUpstreamResponse(
  upstream: Response,
  kcRequestId: string,
  modelUsed?: string,
  provider?: string
): Response {
  const cleanHeaders = sanitizeResponseHeaders(upstream.headers);
  cleanHeaders.set('x-kc-request-id', kcRequestId);
  if (modelUsed) cleanHeaders.set('x-kc-model-used', modelUsed);
  if (provider) cleanHeaders.set('x-kc-provider', provider);

  let body = upstream.body;
  if (upstream.status >= 400 && body) {
    body = body.pipeThrough(createErrorSanitizerTransform());
    cleanHeaders.delete('content-length');
  }

  return new Response(body, {
    status: upstream.status,
    headers: cleanHeaders,
  });
}

