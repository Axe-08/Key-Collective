import { DEFAULT_RPM_LIMIT } from "../../../constants/limits";
import type { AuthTokenRow, AuthTokenRecord } from "./types";

/**
 * Converts a raw D1 database row into a strongly-typed domain AuthTokenRecord.
 */
export function mapRowToAuthTokenRecord(row: AuthTokenRow): AuthTokenRecord {
  let allowedProviders: string[] = [];
  if (row.allowed_providers) {
    try {
      const parsed = JSON.parse(row.allowed_providers);
      if (Array.isArray(parsed)) {
        allowedProviders = parsed.map(String);
      }
    } catch {
      allowedProviders = [];
    }
  }

  const budget =
    typeof row.budget_microdollars === "bigint"
      ? row.budget_microdollars
      : BigInt(row.budget_microdollars ?? 0);

  const spent =
    typeof row.spent_microdollars === "bigint"
      ? row.spent_microdollars
      : BigInt(row.spent_microdollars ?? 0);

  return {
    id: row.id,
    hashSha256: row.hash_sha256,
    tenantId: row.tenant_id,
    encryptedTokenB64: row.encrypted_token_b64,
    nonceB64: row.nonce_b64,
    budgetMicrodollars: budget,
    spentMicrodollars: spent,
    allowedProviders,
    rpmLimit: Number(row.rpm_limit ?? DEFAULT_RPM_LIMIT),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}
