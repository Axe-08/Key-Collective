/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Error Normalizer & Secret Redaction
 *
 * Scans error messages and sanitizes sensitive data (API keys, Bearer tokens, IP addresses)
 * to prevent internal state leakage across gateway error responses.
 */

export const SECRET_REGEX = /(sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9\-\._~+\/]+)/g;
export const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Sanitizes an error message by redacting secret API keys, Bearer tokens, and IPv4 addresses.
 *
 * @param message Raw error message string
 * @returns Sanitized error message string
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) {
    return "";
  }
  return message
    .replace(SECRET_REGEX, "[REDACTED_SECRET]")
    .replace(IP_REGEX, "[REDACTED_IP]");
}
