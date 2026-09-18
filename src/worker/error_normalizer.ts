/**
 * Key Collective v4.0 — Downstream Error Normalizer & Header Sanitizer (FR-10, IR-12)
 * Allow-list response headers policy — only explicitly listed headers forwarded.
 */

export const ALLOWED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type', 'content-length', 'cache-control',
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-request-id',
  'x-kc-request-id', 'x-kc-model-used', 'x-kc-provider', 'x-kc-trace-id',
  'transfer-encoding', 'content-encoding',
]);

const GCP_PROJECT_PATTERN = /projects\/\d{6,12}/gi;
const BILLING_ACCOUNT_PATTERN = /billingAccounts\/[A-Z0-9-]{6,}/gi;
const CLOUD_TRACE_PATTERN = /\b[0-9a-f]{32}\/\d+\b/gi;
export const SECRET_REGEX = /(sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9\-\._~+\/]+)/g;
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

export function sanitizeErrorMessage(message: string): string {
  if (!message) {
    return "";
  }
  return message
    .replace(SECRET_REGEX, "[REDACTED_SECRET]")
    .replace(IP_REGEX, "[REDACTED_IP]");
}

export function sanitizeErrorBody(raw: string): string {
  return raw
    .replace(GCP_PROJECT_PATTERN, '[PROJECT_REDACTED]')
    .replace(BILLING_ACCOUNT_PATTERN, '[BILLING_REDACTED]')
    .replace(CLOUD_TRACE_PATTERN, '[TRACE_REDACTED]')
    .replace(SECRET_REGEX, '[REDACTED_SECRET]')
    .replace(IP_REGEX, '[REDACTED_IP]');
}

export function createErrorSanitizerTransform(): TransformStream<Uint8Array | string, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new TransformStream<Uint8Array | string, Uint8Array>({
    transform(chunk: Uint8Array | string, controller: TransformStreamDefaultController<Uint8Array>) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const sanitized = sanitizeErrorBody(text);
      controller.enqueue(encoder.encode(sanitized));
    },
    flush(controller: TransformStreamDefaultController<Uint8Array>) {
      const remaining = decoder.decode();
      if (remaining) {
        controller.enqueue(encoder.encode(sanitizeErrorBody(remaining)));
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

