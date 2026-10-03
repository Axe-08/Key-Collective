/**
 * Key Collective — key ingress probes (WP-3.6, FR-06, IR-09)
 *
 * forceErrorGcpProbe: calls a non-existent Gemini model so Google answers with an error that
 * names the key's GCP project; that project number feeds the project_hash Sybil guard.
 * checkProofOfLife: one minimal real call proving the key works and has quota.
 */

import { Logger } from "../utils/logger";

export type GcpProbeResult = { projectNumber: string } | { unavailable: string };
export type ProofOfLife = { ok: true } | { error: "key_no_quota" | "key_invalid" | "provider_unavailable" };

const PROBE_TIMEOUT_MS = 8_000;
/** Stable, no shutdown announced, cheapest Gemini 3.5 model (PHASEF_PLAN §2). */
export const PROOF_MODEL_GOOGLE = "gemini-3.5-flash-lite";
/** Production Groq model; verified to answer 200 with max_tokens: 1 (docs/specs/gcp_probe.md). */
export const PROOF_MODEL_GROQ = "openai/gpt-oss-20b";

const probeLogger = new Logger({ traceId: "key-ingress-probe", tenantId: "system" });

interface ProviderErrorBody {
  error?: {
    code?: number | string;
    message?: string;
    status?: string;
    details?: Array<{ "@type"?: string; reason?: string }>;
  };
}

async function readErrorBody(res: Response): Promise<ProviderErrorBody | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as ProviderErrorBody) : null;
  } catch (err) {
    probeLogger.warn("probe_error_body_unparsable", { status: res.status, error: String(err) });
    return null;
  }
}

/** Gemini answers an invalid or revoked key with 400 INVALID_ARGUMENT / API_KEY_INVALID (RA-04). */
function isGeminiKeyInvalid(body: ProviderErrorBody | null): boolean {
  const err = body?.error;
  if (!err) return false;
  if (err.details?.some((d) => d["@type"]?.endsWith("google.rpc.ErrorInfo") && d.reason === "API_KEY_INVALID")) {
    return true;
  }
  return err.status === "INVALID_ARGUMENT" && /API key not valid/i.test(err.message ?? "");
}

/** The proof-of-life model itself is missing or retired: not the key's fault. */
function isModelUnavailable(status: number, body: ProviderErrorBody | null): boolean {
  if (status === 404) return true;
  const code = body?.error?.code;
  return code === "model_not_found" || code === "model_decommissioned";
}

interface GoogleErrorDetail {
  "@type"?: string;
  metadata?: { consumer?: string };
  links?: Array<{ url?: string }>;
  resourceName?: string;
}

const isGoogle = (provider: string) => provider === "google" || provider === "gemini";

function projectFromDetails(details: GoogleErrorDetail[]): string | null {
  for (const d of details) {
    if (d["@type"]?.endsWith("google.rpc.ErrorInfo")) {
      const m = d.metadata?.consumer?.match(/^projects\/([A-Za-z0-9-]+)$/);
      if (m) return m[1];
    }
  }
  for (const d of details) {
    if (d["@type"]?.endsWith("google.rpc.Help")) {
      for (const link of d.links ?? []) {
        const m = link.url?.match(/[?&]project=([A-Za-z0-9-]+)/);
        if (m) return m[1];
      }
    }
    if (d["@type"]?.endsWith("google.rpc.ResourceInfo")) {
      const m = d.resourceName?.match(/projects\/([A-Za-z0-9-]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

/** null for providers without a GCP project (not probed). */
export async function forceErrorGcpProbe(rawKey: string, provider: string): Promise<GcpProbeResult | null> {
  if (!isGoogle(provider)) return null;

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/invalid-model?key=${encodeURIComponent(rawKey)}`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }
    );
  } catch {
    return { unavailable: "network_error" };
  }
  if (res.status !== 400 && res.status !== 404) return { unavailable: `http_${res.status}` };

  const body = (await res.json().catch(() => null)) as { error?: { details?: GoogleErrorDetail[] } } | null;
  const project = projectFromDetails(body?.error?.details ?? []);
  return project ? { projectNumber: project } : { unavailable: "no_project_in_response" };
}

export async function checkProofOfLife(rawKey: string, provider: string): Promise<ProofOfLife> {
  const google = isGoogle(provider);
  const model = google ? PROOF_MODEL_GOOGLE : PROOF_MODEL_GROQ;
  let res: Response;
  try {
    res = google
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": rawKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
      : await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${rawKey}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
  } catch (err) {
    probeLogger.warn("probe_network_error", { provider, model, error: err instanceof Error ? err.name : String(err) });
    return { error: "provider_unavailable" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 429) return { error: "key_no_quota" };
  if (res.status === 401 || res.status === 403) return { error: "key_invalid" };

  const body = await readErrorBody(res);
  if (isModelUnavailable(res.status, body)) {
    probeLogger.warn("probe_model_unavailable", { provider, model, status: res.status });
    return { error: "provider_unavailable" };
  }
  if (res.status === 400 && google && isGeminiKeyInvalid(body)) return { error: "key_invalid" };
  return { error: "provider_unavailable" };
}
