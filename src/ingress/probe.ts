/**
 * Key Collective — key ingress probes (WP-3.6, FR-06, IR-09)
 *
 * forceErrorGcpProbe: calls a non-existent Gemini model so Google answers with an error that
 * names the key's GCP project; that project number feeds the project_hash Sybil guard.
 * checkProofOfLife: one minimal real call proving the key works and has quota.
 */

export type GcpProbeResult = { projectNumber: string } | { unavailable: string };
export type ProofOfLife = { ok: true } | { error: "key_no_quota" | "key_invalid" | "provider_unavailable" };

const PROBE_TIMEOUT_MS = 8_000;
const PROOF_MODEL_GOOGLE = "gemini-2.0-flash";
const PROOF_MODEL_GROQ = "llama-3.1-8b-instant";

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
  let res: Response;
  try {
    res = isGoogle(provider)
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PROOF_MODEL_GOOGLE}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": rawKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
      : await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${rawKey}` },
          body: JSON.stringify({ model: PROOF_MODEL_GROQ, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
  } catch {
    return { error: "provider_unavailable" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 429) return { error: "key_no_quota" };
  if (res.status === 401 || res.status === 403) return { error: "key_invalid" };
  if (res.status === 400 && isGoogle(provider)) return { error: "key_invalid" };
  return { error: "provider_unavailable" };
}
