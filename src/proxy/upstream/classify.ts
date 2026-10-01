/**
 * Key Collective — Upstream Response Classifier (WP-4.3 T-4.3.1)
 *
 * Maps upstream HTTP responses and errors to deterministic lease settlement outcomes:
 * - 200 -> `ok` (counters, breaker success)
 * - 401, 403 (`API_KEY_INVALID`, `PERMISSION_DENIED`) -> `key_invalid` (`QUARANTINED`, notify owner)
 * - 429 with Gemini `QuotaFailure.violations[].quotaId` containing `PerDay`,
 *   or Groq `x-ratelimit-remaining-requests: 0` with reset > 1 h -> `rpd_exhausted` (`COOLDOWN`)
 * - other 429 -> `rpm_limited` (`COOLDOWN` for `retry-after`, default 60 s)
 * - 5xx, timeout -> `upstream_error` (breaker failure; open after 5 consecutive, half-open after 60 s)
 * - 400 -> `request_error` (no key action; return 400 to client sanitised, do not fall back)
 */

import { parseRetryAfter } from "./headers";

export type UpstreamOutcome =
  | "ok"
  | "key_invalid"
  | "rpd_exhausted"
  | "rpm_limited"
  | "upstream_error"
  | "request_error";

export interface UpstreamResponseInput {
  status?: number;
  headers?: Headers | Record<string, string | undefined> | null;
  body?: unknown;
  timedOut?: boolean;
  nowMs?: number;
}

export interface UpstreamClassification {
  outcome: UpstreamOutcome;
  retryAfterSeconds?: number;
  cooldownUntilMs?: number;
  shouldFallback: boolean;
}

const ONE_HOUR_SECONDS = 3600;
const DEFAULT_RPD_COOLDOWN_SECONDS = 24 * 3600;

function getHeader(
  headers: Headers | Record<string, string | undefined> | null | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? (headers as Headers).get(target);
  }
  const record = headers as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === target && typeof v === "string") {
      return v;
    }
  }
  return null;
}

/**
 * Parses duration strings such as Groq's `2h15m30s`, `90m`, `3600s`, plain seconds `7200`,
 * or HTTP date strings into seconds.
 */
export function parseResetDurationSeconds(
  raw: string | null | undefined,
  nowMs: number
): number | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();

  // Go-style duration string: e.g. "2h15m30.5s", "1h", "90m", "45s", "500ms"
  const durationRegex =
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i;
  const match = trimmed.match(durationRegex);
  if (match && (match[1] || match[2] || match[3] || match[4])) {
    const hours = match[1] ? parseFloat(match[1]) : 0;
    const minutes = match[2] ? parseFloat(match[2]) : 0;
    const seconds = match[3] ? parseFloat(match[3]) : 0;
    const millis = match[4] ? parseFloat(match[4]) : 0;
    return Math.ceil(hours * 3600 + minutes * 60 + seconds + millis / 1000);
  }

  // Plain numeric seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = parseFloat(trimmed);
    if (!Number.isNaN(num) && num >= 0) {
      return Math.ceil(num);
    }
  }

  // HTTP date
  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isNaN(parsedDateMs)) {
    return Math.max(1, Math.ceil((parsedDateMs - nowMs) / 1000));
  }

  return null;
}

function hasGeminiPerDayQuotaViolation(body: unknown): boolean {
  if (!body) return false;

  let parsed: unknown = body;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length === 0) return false;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Fallback if body is raw text containing QuotaFailure and PerDay
      return /QuotaFailure/i.test(trimmed) && /PerDay/i.test(trimmed);
    }
  }

  if (!parsed || typeof parsed !== "object") return false;
  const root = parsed as Record<string, unknown>;
  const errObj =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;

  const details = Array.isArray(errObj.details)
    ? errObj.details
    : Array.isArray(root.details)
    ? root.details
    : [];

  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const d = detail as Record<string, unknown>;
    const typeStr = typeof d["@type"] === "string" ? d["@type"] : "";
    if (typeStr && !typeStr.includes("QuotaFailure")) continue;

    const violations = Array.isArray(d.violations) ? d.violations : [];
    for (const v of violations) {
      if (!v || typeof v !== "object") continue;
      const quotaId = (v as Record<string, unknown>).quotaId;
      if (typeof quotaId === "string" && /PerDay/i.test(quotaId)) {
        return true;
      }
    }
  }

  // Also check top-level violations if structured directly as QuotaFailure
  if (Array.isArray(errObj.violations)) {
    for (const v of errObj.violations) {
      if (!v || typeof v !== "object") continue;
      const quotaId = (v as Record<string, unknown>).quotaId;
      if (typeof quotaId === "string" && /PerDay/i.test(quotaId)) {
        return true;
      }
    }
  }

  return false;
}

export function classifyUpstreamResponse(
  input: UpstreamResponseInput
): UpstreamClassification {
  const nowMs = input.nowMs ?? Date.now();
  const status = input.status ?? 0;

  if (input.timedOut || status === 408 || status === 504) {
    return {
      outcome: "upstream_error",
      shouldFallback: true,
    };
  }

  if (status >= 200 && status < 300) {
    return {
      outcome: "ok",
      shouldFallback: false,
    };
  }

  if (status === 401 || status === 403) {
    return {
      outcome: "key_invalid",
      shouldFallback: true,
    };
  }

  if (status === 429) {
    // 1. Check Gemini QuotaFailure.violations[].quotaId containing PerDay
    if (hasGeminiPerDayQuotaViolation(input.body)) {
      const retryAfterRaw = getHeader(input.headers, "retry-after");
      const resetSec =
        parseResetDurationSeconds(retryAfterRaw, nowMs) ?? DEFAULT_RPD_COOLDOWN_SECONDS;
      const effectiveSec = Math.max(ONE_HOUR_SECONDS + 1, resetSec);
      return {
        outcome: "rpd_exhausted",
        retryAfterSeconds: effectiveSec,
        cooldownUntilMs: nowMs + effectiveSec * 1000,
        shouldFallback: true,
      };
    }

    // 2. Check Groq x-ratelimit-remaining-requests: 0 with a reset > 1 h
    const remainingReq = getHeader(input.headers, "x-ratelimit-remaining-requests");
    if (remainingReq !== null && remainingReq.trim() === "0") {
      const resetHeader =
        getHeader(input.headers, "x-ratelimit-reset-requests") ??
        getHeader(input.headers, "x-ratelimit-reset") ??
        getHeader(input.headers, "retry-after");
      const resetSec = parseResetDurationSeconds(resetHeader, nowMs);
      if (resetSec !== null && resetSec > ONE_HOUR_SECONDS) {
        return {
          outcome: "rpd_exhausted",
          retryAfterSeconds: resetSec,
          cooldownUntilMs: nowMs + resetSec * 1000,
          shouldFallback: true,
        };
      }
    }

    // 3. Other 429 -> rpm_limited (COOLDOWN for retry-after, default 60 s)
    const retryAfterHeader = getHeader(input.headers, "retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? parseResetDurationSeconds(retryAfterHeader, nowMs) ?? parseRetryAfter(retryAfterHeader)
      : 60;
    return {
      outcome: "rpm_limited",
      retryAfterSeconds,
      cooldownUntilMs: nowMs + retryAfterSeconds * 1000,
      shouldFallback: true,
    };
  }

  if (status === 400) {
    return {
      outcome: "request_error",
      shouldFallback: false,
    };
  }

  // 5xx or any other unexpected upstream failure
  return {
    outcome: "upstream_error",
    shouldFallback: true,
  };
}

export function classifyUpstreamError(
  err: unknown,
  nowMs?: number
): UpstreamClassification {
  if (!err || typeof err !== "object") {
    return {
      outcome: "upstream_error",
      shouldFallback: true,
    };
  }

  const errObj = err as Record<string, unknown>;
  const details =
    errObj.details && typeof errObj.details === "object"
      ? (errObj.details as Record<string, unknown>)
      : {};

  // Check if already classified
  if (
    details.classification &&
    typeof details.classification === "object" &&
    "outcome" in (details.classification as Record<string, unknown>)
  ) {
    return details.classification as UpstreamClassification;
  }

  const timedOut =
    errObj.name === "ProviderTimeoutError" ||
    errObj.code === "provider_timeout" ||
    Boolean(details.timedOut);

  const status =
    typeof errObj.upstreamStatusCode === "number"
      ? errObj.upstreamStatusCode
      : typeof details.upstreamStatusCode === "number"
      ? details.upstreamStatusCode
      : typeof errObj.statusCode === "number"
      ? errObj.statusCode
      : 0;

  const headers =
    (details.upstreamHeaders as Record<string, string | undefined> | Headers | undefined) ??
    (errObj.headers as Record<string, string | undefined> | Headers | undefined) ??
    null;

  const body =
    details.upstreamBody !== undefined
      ? details.upstreamBody
      : errObj.body !== undefined
      ? errObj.body
      : typeof errObj.message === "string"
      ? errObj.message
      : undefined;

  const effectiveHeaders: Record<string, string | undefined> = {};
  if (headers) {
    if (typeof (headers as Headers).entries === "function") {
      for (const [k, v] of (headers as Headers).entries()) {
        effectiveHeaders[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(headers as Record<string, string | undefined>)) {
        effectiveHeaders[k.toLowerCase()] = v;
      }
    }
  }
  if (
    typeof errObj.retryAfterSeconds === "number" &&
    effectiveHeaders["retry-after"] === undefined
  ) {
    effectiveHeaders["retry-after"] = String(errObj.retryAfterSeconds);
  }

  return classifyUpstreamResponse({
    status,
    headers: effectiveHeaders,
    body,
    timedOut,
    nowMs,
  });
}
