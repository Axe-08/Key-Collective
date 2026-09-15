/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: Main D1StorageAdapter Class
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - No Plaintext Keys (AES-256-GCM + 12-byte nonces in D1).
 * - Per-Tenant Isolation (Strict tenant boundaries).
 * - Fixed-Point Microdollars (Bigint microdollars, zero floats).
 */

import type { EncryptedKey } from "../../contracts/key_pool";
import type { TelemetryEvent } from "../../contracts/telemetry";
import type {
  CostLedgerRecordInput,
  DailySpendRollupRecord,
  RollupInput,
  TenantMetrics,
} from "./types";
import { getKeysForTenant, getKeyById, saveEncryptedKey, deleteKey } from "./keys";
import { saveRollup, getTenantMetrics, getDailyRollups } from "./rollups";
import { recordCostLedgerEvent, recordTelemetry } from "./ledger";

export class D1StorageAdapter {
  constructor(private readonly db: D1Database) {
    if (!db) {
      throw new Error("D1Database instance is required");
    }
  }

  async getKeysForTenant(tenantId: string): Promise<EncryptedKey[]> {
    return getKeysForTenant(this.db, tenantId);
  }

  async getKeyById(tenantId: string, keyId: string): Promise<EncryptedKey | null> {
    return getKeyById(this.db, tenantId, keyId);
  }

  async saveEncryptedKey(key: EncryptedKey): Promise<void> {
    return saveEncryptedKey(this.db, key);
  }

  async deleteKey(tenantId: string, keyId: string): Promise<void> {
    return deleteKey(this.db, tenantId, keyId);
  }

  async saveRollup(rollup: RollupInput): Promise<void> {
    return saveRollup(this.db, rollup);
  }

  async getTenantMetrics(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<TenantMetrics> {
    return getTenantMetrics(this.db, tenantId, startDate, endDate);
  }

  async aggregateMetrics(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<TenantMetrics> {
    return this.getTenantMetrics(tenantId, startDate, endDate);
  }

  async getDailyRollups(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<DailySpendRollupRecord[]> {
    return getDailyRollups(this.db, tenantId, startDate, endDate);
  }

  async recordCostLedgerEvent(event: CostLedgerRecordInput): Promise<void> {
    return recordCostLedgerEvent(this.db, event);
  }

  async recordTelemetry(event: TelemetryEvent): Promise<void> {
    return recordTelemetry(this.db, event);
  }
}
