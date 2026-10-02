/**
 * Key Collective v2 — Standard V1 Response Headers
 *
 * Enforces PRD section 12 information boundary:
 * Every /v1 response carries:
 * - x-kc-request-id: kc_req_<uuid>
 * - x-kc-model-used: string (when present in ctx)
 * - x-kc-provider: string (when present in ctx)
 * - x-kc-attempts: string (default 1)
 *
 * Non-streaming responses additionally carry:
 * - x-kc-cu: string (when present in ctx)
 * - x-kc-cost-microdollars: string (when present in ctx, preserved until WP-6.5)
 *
 * Forbidden internal routing headers stripped:
 * - x-kc-tenant-id
 * - x-kc-trace-id
 * - x-kc-model
 */

export interface KcHeaderContext {
  requestId?: string;
  traceId?: string;
  modelUsed?: string;
  model?: string;
  provider?: string;
  attempts?: number | string | unknown[];
  cu?: number | string | bigint;
  costMicrodollars?: number | string | bigint;
  isStream?: boolean;
  commonsNotice?: string;
}

/**
 * Applies Key Collective standard response headers and strips internal routing headers.
 */
export function applyKcHeaders(res: Response, ctx: KcHeaderContext = {}): Response {
  let targetRes = res;
  let headers = res.headers;

  try {
    headers.set("x-kc-test-mut", "1");
    headers.delete("x-kc-test-mut");
  } catch {
    headers = new Headers(res.headers);
    targetRes = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // Extract or generate request ID formatted as kc_req_<uuid>
  const rawId =
    ctx.requestId ??
    ctx.traceId ??
    headers.get("x-kc-request-id") ??
    headers.get("x-kc-trace-id");

  const IS_HEX_DASH = /^[0-9a-f-]+$/i;
  let requestId: string;
  if (rawId && rawId.startsWith("kc_req_") && IS_HEX_DASH.test(rawId.slice(7))) {
    requestId = rawId;
  } else if (rawId && IS_HEX_DASH.test(rawId) && rawId.includes("-")) {
    requestId = `kc_req_${rawId}`;
  } else {
    requestId = `kc_req_${crypto.randomUUID()}`;
  }
  headers.set("x-kc-request-id", requestId);

  // Model used & provider
  const modelUsed =
    ctx.modelUsed ??
    ctx.model ??
    headers.get("x-kc-model-used") ??
    headers.get("x-kc-model");
  if (modelUsed) {
    headers.set("x-kc-model-used", modelUsed);
  }

  const provider = ctx.provider ?? headers.get("x-kc-provider");
  if (provider) {
    headers.set("x-kc-provider", provider);
  }

  // Attempts (default 1)
  let attempts = 1;
  if (ctx.attempts !== undefined) {
    if (typeof ctx.attempts === "number") {
      attempts = ctx.attempts;
    } else if (Array.isArray(ctx.attempts)) {
      attempts = ctx.attempts.length + 1;
    } else if (typeof ctx.attempts === "string") {
      attempts = parseInt(ctx.attempts, 10) || 1;
    }
  } else if (headers.has("x-kc-attempts")) {
    attempts = parseInt(headers.get("x-kc-attempts")!, 10) || 1;
  }
  headers.set("x-kc-attempts", String(attempts));

  // Determine streaming vs non-streaming
  const isStream =
    ctx.isStream === true ||
    headers.get("content-type")?.includes("text/event-stream") === true;

  if (!isStream) {
    const cu = ctx.cu !== undefined ? String(ctx.cu) : headers.get("x-kc-cu");
    if (cu !== null && cu !== undefined) {
      headers.set("x-kc-cu", cu);
    }
    const costMicrodollars =
      ctx.costMicrodollars !== undefined
        ? String(ctx.costMicrodollars)
        : headers.get("x-kc-cost-microdollars");
    if (costMicrodollars !== null && costMicrodollars !== undefined) {
      headers.set("x-kc-cost-microdollars", costMicrodollars);
    }
  } else {
    headers.delete("x-kc-cu");
  }

  const commonsNotice = ctx.commonsNotice ?? headers.get("x-kc-commons-notice");
  if (commonsNotice) {
    headers.set("x-kc-commons-notice", commonsNotice);
  }

  // Strip internal routing headers
  headers.delete("x-kc-tenant-id");
  headers.delete("x-kc-trace-id");
  headers.delete("x-kc-model");

  return targetRes;
}
