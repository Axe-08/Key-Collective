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
    typeof row.budget_amount === "bigint"
      ? row.budget_amount
      : (row.budget_amount != null && !isNaN(Number(row.budget_amount)))
        ? BigInt(row.budget_amount)
        : 0n;

  const spent =
    typeof row.spent_amount === "bigint"
      ? row.spent_amount
      : (row.spent_amount != null && !isNaN(Number(row.spent_amount)))
        ? BigInt(row.spent_amount)
        : 0n;

  return {
    id: row.id,
    hashSha256: row.hash_sha256,
    tenantId: row.tenant_id,
    encryptedTokenB64: row.encrypted_token_b64,
    nonceB64: row.nonce_b64,
    budgetCeilingCu: budget,
    spentTotalCu: spent,
    allowedProviders,
    rpmLimit: Number(row.rpm_limit ?? DEFAULT_RPM_LIMIT),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    projectId: row.project_id ?? null,
  };
}
