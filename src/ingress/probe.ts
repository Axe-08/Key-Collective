/**
 * Key Collective — key ingress probes (WP-3.6, FR-06, IR-09)
 *
 * forceErrorGcpProbe: calls a Google API the key may not use (Translation, then YouTube) so Google
 * answers with an ErrorInfo naming the key's GCP project; that project number feeds the
 * project_hash Sybil guard (WP-F.4, docs/specs/gcp_probe.md).
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
  reason?: string;
  metadata?: { consumer?: string; containerInfo?: string; activationUrl?: string };
  links?: Array<{ url?: string }>;
  resourceName?: string;
}

const isGoogle = (provider: string) => provider === "google" || provider === "gemini";

/**
 * Google endpoints the key is (almost always) not allowed to call. Their 403 error names the
 * key's project in ErrorInfo.metadata.consumer (docs/specs/gcp_probe.md, RA-07):
 * - Translation v2: API_KEY_SERVICE_BLOCKED when the key's API restrictions exclude it;
 * - YouTube Data v3: SERVICE_DISABLED when the API is not enabled in the project.
 * The Gemini invalid-model 404 carries no details, so it can never name the project.
 */
export const GCP_PROBE_ENDPOINTS = [
  "https://translation.googleapis.com/language/translate/v2?q=hi&target=fr",
  "https://youtube.googleapis.com/youtube/v3/videos?part=id&id=x",
] as const;

const PROJECT_PARAM = /[?&]project=([A-Za-z0-9-]+)/;

function projectFromDetails(details: GoogleErrorDetail[]): string | null {
  const errorInfos = details.filter((d) => d["@type"]?.endsWith("google.rpc.ErrorInfo"));
  // 1. ErrorInfo.metadata.consumer = "projects/<n>"
  for (const d of errorInfos) {
    const m = d.metadata?.consumer?.match(/^projects\/([A-Za-z0-9-]+)$/);
    if (m) return m[1];
  }
  // 2. ErrorInfo.metadata.containerInfo = "<n>"
  for (const d of errorInfos) {
    const c = d.metadata?.containerInfo?.trim();
    if (c && /^[A-Za-z0-9-]+$/.test(c)) return c;
  }
  // 3. project=<n> in Help links or ErrorInfo.metadata.activationUrl
  for (const d of details) {
    if (d["@type"]?.endsWith("google.rpc.Help")) {
      for (const link of d.links ?? []) {
        const m = link.url?.match(PROJECT_PARAM);
        if (m) return m[1];
      }
    }
  }
  for (const d of errorInfos) {
    const m = d.metadata?.activationUrl?.match(PROJECT_PARAM);
    if (m) return m[1];
  }
  for (const d of details) {
    if (d["@type"]?.endsWith("google.rpc.ResourceInfo")) {
      const m = d.resourceName?.match(/projects\/([A-Za-z0-9-]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

type EndpointOutcome = { projectNumber: string } | { reason: string };

async function probeEndpoint(url: string, rawKey: string): Promise<EndpointOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-goog-api-key": rawKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    probeLogger.warn("gcp_probe_network_error", { endpoint: new URL(url).host, error: err instanceof Error ? err.name : String(err) });
    return { reason: "network_error" };
  }
  if (res.ok) return { reason: "service_allowed" };

  const body = (await readErrorBody(res)) as { error?: { details?: GoogleErrorDetail[] } } | null;
  const project = projectFromDetails(body?.error?.details ?? []);
  if (project) return { projectNumber: project };
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
    return { reason: "no_project_in_response" };
  }
  return { reason: `http_${res.status}` };
}

/** null for providers without a GCP project (not probed). */
export async function forceErrorGcpProbe(rawKey: string, provider: string): Promise<GcpProbeResult | null> {
  if (!isGoogle(provider)) return null;

  const reasons: string[] = [];
  for (const url of GCP_PROBE_ENDPOINTS) {
    const outcome = await probeEndpoint(url, rawKey);
    if ("projectNumber" in outcome) return { projectNumber: outcome.projectNumber };
    reasons.push(outcome.reason);
  }
  // The key may call every probe endpoint, so no error names its project.
  if (reasons.every((r) => r === "service_allowed")) return { unavailable: "both_services_allowed" };
  return { unavailable: reasons.find((r) => r !== "service_allowed") ?? "no_project_in_response" };
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
