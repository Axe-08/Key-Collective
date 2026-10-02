/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPoolDO — Per-Tenant Stateful Durable Object Pool
 */

import { DurableObject } from "cloudflare:workers";
import {
  EncryptedKey,
  KeyMetrics,
  KeyPoolContract,
} from "../../contracts/key_pool";
import { TelemetryContract, TelemetryEvent } from "../../contracts/telemetry";
import { TenantIsolationError } from "../../errors/auth_errors";
import {
  InvalidKeyError,
  KeyNotFoundError,
} from "../../errors/key_errors";
import {
  CircuitBreaker,
  CircuitBreakerState,
} from "../circuit_breaker";
import {
  CapacitySummary,
  KeySelector,
} from "../key_selector";
import { RateLimiter, RateLimiterMetrics } from "../rate_limiter";
import { normaliseKeyStatus, normalisePoolType } from "../../contracts/keys";
import { checkProofOfLife } from "../../ingress/probe";
import { canonicalCoordinatorProvider } from "../../pool/coordinator_do";
import { Clock, systemClock } from "../../utils/clock";
import { Logger } from "../../utils/logger";
import type { WorkerEnv } from "../../worker/auth/types";
import { resolveLeasedKey } from "../../worker/router/core/key_resolver";
import {
  DurableObjectStateLike,
  isEncryptedKey,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
} from "./types";

export type PrivateLeaseOutcome =
  | "ok"
  | "key_invalid"
  | "rpd_exhausted"
  | "rpm_limited"
  | "upstream_error"
  | "request_error";

export interface PrivateKeyLease {
  leaseId: string;
  keyId: string;
  provider: string;
  ownerTenantId: string;
  source: "private";
}

export interface PrivateSettleResult {
  settled: boolean;
  duplicate: boolean;
}

interface PrivateLeaseRecord {
  leaseId: string;
  keyId: string;
  provider: string;
  estimateCu: number;
  createdAt: number;
  settled: boolean;
  settledAt?: number;
}

declare module "./types" {
  interface KeyPoolDOOptions {
    /** Injectable Clock for deterministic testing */
    clock?: Clock;
  }
}

/**
 * KeyPoolDO — Stateful Per-Tenant Durable Object.
 * Single source of truth for key health, rate limits, and selection within a tenant.
 */
export class KeyPoolDO extends DurableObject<KeyPoolDOEnv> implements KeyPoolContract {
  public tenantId!: string;
  private tenantBound = false;
  private storageKeyPrefix!: string;
  private clock!: Clock;
  private timeProvider!: () => number;
  private alarmBootstrapPromise!: Promise<void>;

  private circuitBreaker!: CircuitBreaker;
  private rateLimiter!: RateLimiter;
  private keySelector!: KeySelector<EncryptedKey>;
  private telemetryEmitter?: TelemetryContract;

  private isLoaded = false;
  private privateReconciled = false;
  private ownerHasCommunityPool = true;

  private keysMap!: Map<string, EncryptedKey>;
  private leasesMap!: Map<string, PrivateLeaseRecord>;
  private providerOverrides!: Map<string, { state: "TRIPPED" | "NORMAL"; until?: number }>;

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: KeyPoolDOEnv,
    options?: KeyPoolDOOptions
  ) {
    let instance: KeyPoolDO;
    try {
      super(ctx as DurableObjectState, (env ?? {}) as KeyPoolDOEnv);
      instance = this;
    } catch {
      instance = Object.create(new.target.prototype) as KeyPoolDO;
      Object.assign(instance as unknown as Record<string, unknown>, {
        ctx,
        env: env ?? {},
      });
    }
    instance.initKeyPoolInstance(options);
    return instance;
  }

  private initKeyPoolInstance(options?: KeyPoolDOOptions): void {
    this.tenantBound = false;
    this.storageKeyPrefix = "pool:";
    this.isLoaded = false;
    this.privateReconciled = false;
    this.ownerHasCommunityPool = true;
    this.keysMap = new Map<string, EncryptedKey>();
    this.leasesMap = new Map<string, PrivateLeaseRecord>();
    this.providerOverrides = new Map<string, { state: "TRIPPED" | "NORMAL"; until?: number }>();

    this.clock = options?.clock ?? systemClock;
    this.timeProvider = options?.timeProvider ?? (() => this.clock.now());

    // Resolve tenant ID strictly:
    const namedTenant = options?.tenantId ?? this.ctx.id.name;
    this.tenantBound = typeof namedTenant === "string" && namedTenant.trim().length > 0;
    const resolvedTenant =
      namedTenant ??
      (this.ctx.id.toString ? this.ctx.id.toString() : "default");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("KeyPoolDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;

    const alarmBootstrap = async () => {
      const alarmStorage = this.ctx.storage as unknown as {
        getAlarm?(): Promise<number | null>;
        setAlarm?(t: number): Promise<void>;
      };
      if (typeof alarmStorage?.getAlarm === "function") {
        const alarm = await alarmStorage.getAlarm();
        if (!alarm && typeof alarmStorage?.setAlarm === "function") {
          const tomorrow = new Date(this.clock.now());
          tomorrow.setUTCHours(24, 0, 0, 0);
          await alarmStorage.setAlarm(tomorrow.getTime());
        }
      }
    };
    if (typeof this.ctx.blockConcurrencyWhile === "function") {
      this.alarmBootstrapPromise = this.ctx.blockConcurrencyWhile(alarmBootstrap);
    } else {
      this.alarmBootstrapPromise = alarmBootstrap();
    }

    // Initialize dependencies
    this.circuitBreaker =
      options?.circuitBreaker ??
      new CircuitBreaker(this.ctx.storage, {
        failureThreshold: 5,
        cooldownSeconds: 60,
        timeProvider: this.timeProvider,
      });

    this.rateLimiter =
      options?.rateLimiter ??
      new RateLimiter(this.ctx.storage, {
        tenantId: this.tenantId,
        timeProvider: this.timeProvider,
      });

    this.keySelector =
      options?.keySelector ??
      new KeySelector<EncryptedKey>({
        tenantId: this.tenantId,
        defaultStrategy: "priority",
        circuitBreaker: this.circuitBreaker,
        rateLimiter: this.rateLimiter,
        storage: this.ctx.storage,
        timeProvider: this.timeProvider,
      });

    this.telemetryEmitter = options?.telemetryEmitter;

    // Pre-populate keys if provided
    if (options?.keys && options.keys.length > 0) {
      for (const k of options.keys) {
        const isCommunal = k.poolType === "COMMUNITY";
        if (!isCommunal) {
          this.assertTenant(k.tenantId, k.id);
        }
        const safeKey: EncryptedKey = {
          ...k,
          tenantId: k.tenantId && k.tenantId.trim().length > 0 ? k.tenantId : this.tenantId,
        };
        this.keysMap.set(k.id, safeKey);
      }
      this.keySelector.setKeys(Array.from(this.keysMap.values()));
      this.isLoaded = true;
      this.privateReconciled = true;
    }
  }

  /**
   * Current timestamp in milliseconds.
   */
  private now(): number {
    return this.timeProvider();
  }

  // =========================================================================
  // Tenant Isolation Assertion (GEMINI.md Invariant)
  // =========================================================================

  public assertTenant(targetTenantId?: string, resourceId?: string): void {
    if (!targetTenantId) {
      return;
    }
    if (!this.tenantBound || this.tenantId === this.ctx.id.toString()) {
      this.tenantId = targetTenantId;
      this.tenantBound = true;
      return;
    }
    if (targetTenantId !== this.tenantId) {
      throw new TenantIsolationError(
        `Tenant isolation violation: attempt to access/mutate tenant '${targetTenantId}' in Durable Object for tenant '${this.tenantId}'`,
        {
          tenantId: this.tenantId,
          attemptedTenantId: targetTenantId,
          resourceId,
        }
      );
    }
  }

  // =========================================================================
  // Storage & State Hydration (DO Transactional Storage)
  // =========================================================================

  private getStorageKey(): string {
    return `${this.storageKeyPrefix}keys`;
  }

  private getTenantStorageKey(): string {
    return `${this.storageKeyPrefix}tenantId`;
  }

  private async persistKeys(): Promise<void> {
    const keysArray = Array.from(this.keysMap.values());
    await this.ctx.storage.put<EncryptedKey[]>(this.getStorageKey(), keysArray);
    await this.ctx.storage.put<string>(this.getTenantStorageKey(), this.tenantId);
  }

  private getLeaseStorageKey(leaseId: string): string {
    return `${this.storageKeyPrefix}lease:${leaseId}`;
  }

  private nextUtcMidnightMs(nowMs: number): number {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  }

  public async ensureLoaded(): Promise<void> {
    await this.alarmBootstrapPromise.catch(() => {});
    if (this.isLoaded) {
      return;
    }

    const savedTenant = await this.ctx.storage.get<string>(this.getTenantStorageKey());
    if (savedTenant && (!this.tenantBound || this.tenantId === this.ctx.id.toString())) {
      this.tenantId = savedTenant;
      this.tenantBound = true;
    }

    const storedKeys = await this.ctx.storage.get<EncryptedKey[]>(
      this.getStorageKey()
    );

    if (storedKeys && Array.isArray(storedKeys)) {
      for (const k of storedKeys) {
        if (isEncryptedKey(k)) {
          const isCommunal = k.poolType === "COMMUNITY";
          if (!isCommunal) {
            this.assertTenant(k.tenantId, k.id);
          }
          const safeKey: EncryptedKey = {
            ...k,
            tenantId: k.tenantId && k.tenantId.trim().length > 0 ? k.tenantId : this.tenantId,
          };
          this.keysMap.set(k.id, safeKey);
        }
      }
      this.keySelector.setKeys(Array.from(this.keysMap.values()));
    }

    if (this.keysMap.size === 0 && this.env.DB && typeof this.env.DB.prepare === "function") {
      try {
        const stmt = this.env.DB.prepare(
          `SELECT k.id, k.tenant_id, k.label, k.provider, k.encrypted_key_b64, k.nonce_b64,
                  k.rpm_limit, k.rpd_limit, k.priority, k.status, k.pool_type
           FROM api_keys k
           WHERE k.tenant_id = ? AND k.status = 'HEALTHY'`
        ).bind(this.tenantId);
        const result = await stmt.all<{
          id: string;
          tenant_id: string;
          label: string;
          provider: string;
          encrypted_key_b64: string;
          nonce_b64: string;
          rpm_limit: number;
          rpd_limit: number;
          priority: number;
          status: string;
          pool_type?: string;
        }>();
        if (result.results && result.results.length > 0) {
          const d1Keys: EncryptedKey[] = result.results.map((row) => ({
            id: row.id,
            tenantId: this.tenantId,
            provider: row.provider,
            ciphertext: row.encrypted_key_b64,
            nonce: row.nonce_b64,
            label: row.label,
            priority: 10000,
            rpmLimit: row.rpm_limit,
            rpdLimit: row.rpd_limit,
            status: normaliseKeyStatus(row.status),
            poolType: row.pool_type != null ? normalisePoolType(row.pool_type) : "PRIVATE",
          }));
          for (const k of d1Keys) {
            this.keysMap.set(k.id, k);
          }
          this.keySelector.setKeys(Array.from(this.keysMap.values()));
          await this.ctx.storage.put<EncryptedKey[]>(this.getStorageKey(), d1Keys);
          await this.ctx.storage.put<string>(this.getTenantStorageKey(), this.tenantId);
        }
      } catch {
        // Fallback: Proceed with existing keys
      }
    }

    await this.reconcileSyncPending();
    this.isLoaded = true;
  }

  /**
   * Reconciles this tenant's keys and communityPool rights from D1 (WP-4.1, T-4.1.3).
   * Called on first leasePrivate access and after key add/delete/pool-mode mutations.
   */
  public async reconcile(tenantId?: string): Promise<number> {
    await this.alarmBootstrapPromise.catch(() => {});
    if (tenantId) {
      this.assertTenant(tenantId);
    }
    if (!this.isLoaded) {
      await this.ensureLoaded();
    }

    const db = this.env.DB;
    if (!db || typeof db.prepare !== "function") {
      this.privateReconciled = true;
      return this.keysMap.size;
    }

    const rightsRow = await db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM users WHERE id = ?) AS has_user,
           EXISTS (
             SELECT 1 FROM users u
              WHERE u.id = ? AND u.registration_status = 'ACTIVE'
                AND COALESCE(u.is_quarantined, 0) = 0 AND u.community_eligible = 1
                AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google')
                AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'github')
           ) AS has_community_pool`
      )
      .bind(this.tenantId, this.tenantId)
      .first<{ has_user: number; has_community_pool: number }>();

    if (rightsRow && Number(rightsRow.has_user) > 0) {
      this.ownerHasCommunityPool = Number(rightsRow.has_community_pool) > 0;
    } else {
      this.ownerHasCommunityPool = true;
    }

    const res = await db
      .prepare(
        `SELECT id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
                rpm_limit, rpd_limit, priority, status, pool_type
           FROM api_keys
          WHERE tenant_id = ? AND upper(status) != 'REVOKED'`
      )
      .bind(this.tenantId)
      .all<{
        id: string;
        tenant_id: string;
        label: string;
        provider: string;
        encrypted_key_b64: string;
        nonce_b64: string;
        rpm_limit: number;
        rpd_limit: number;
        priority: number;
        status: string;
        pool_type: string | null;
      }>();

    const rows = res.results ?? [];
    const seenIds = new Set<string>();

    for (const row of rows) {
      seenIds.add(row.id);
      const existing = this.keysMap.get(row.id);
      const normStatus = normaliseKeyStatus(row.status);
      const preserveCooldown =
        existing?.status === "COOLDOWN" &&
        existing.cooldownUntil &&
        existing.cooldownUntil > this.now() &&
        normStatus !== "QUARANTINED";

      const updated: EncryptedKey = {
        id: row.id,
        tenantId: this.tenantId,
        provider: row.provider,
        ciphertext: row.encrypted_key_b64,
        nonce: row.nonce_b64,
        label: row.label,
        priority: 10000 + (row.priority ?? 0),
        rpmLimit: row.rpm_limit,
        rpdLimit: row.rpd_limit,
        status: preserveCooldown ? "COOLDOWN" : normStatus,
        cooldownUntil: preserveCooldown ? existing?.cooldownUntil : null,
        poolType: normalisePoolType(row.pool_type ?? "PRIVATE"),
      };
      this.keysMap.set(row.id, updated);
    }

    // Remove keys owned by this tenant that are no longer in D1 (deleted or revoked)
    for (const [id, k] of Array.from(this.keysMap.entries())) {
      if (k.tenantId === this.tenantId && !seenIds.has(id)) {
        this.keysMap.delete(id);
        this.keySelector.removeKey(id);
      }
    }

    await db
      .prepare("UPDATE api_keys SET sync_pending = 0 WHERE tenant_id = ? AND sync_pending = 1")
      .bind(this.tenantId)
      .run();

    this.keySelector.setKeys(Array.from(this.keysMap.values()));
    await this.persistKeys();
    this.privateReconciled = true;
    return seenIds.size;
  }

  /**
   * Keys whose push from POST /api/keys failed are flagged sync_pending in D1 (WP-3.6).
   * Pull this tenant's flagged keys into the pool and clear the flag.
   */
  private async reconcileSyncPending(): Promise<void> {
    const db = this.env.DB;
    if (!db || typeof db.prepare !== "function") return;
    const pending = await db
      .prepare(
        `SELECT id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, rpm_limit, rpd_limit, priority, status, pool_type
           FROM api_keys WHERE tenant_id = ? AND sync_pending = 1`
      )
      .bind(this.tenantId)
      .all<{
        id: string;
        tenant_id: string;
        label: string;
        provider: string;
        encrypted_key_b64: string;
        nonce_b64: string;
        rpm_limit: number;
        rpd_limit: number;
        priority: number;
        status: string;
        pool_type: string | null;
      }>();
    const rows = pending.results ?? [];
    if (rows.length === 0) return;
    for (const row of rows) {
      this.keysMap.set(row.id, {
        id: row.id,
        tenantId: this.tenantId,
        provider: row.provider,
        ciphertext: row.encrypted_key_b64,
        nonce: row.nonce_b64,
        label: row.label,
        priority: 10000 + row.priority,
        rpmLimit: row.rpm_limit,
        rpdLimit: row.rpd_limit,
        status: normaliseKeyStatus(row.status),
        poolType: normalisePoolType(row.pool_type ?? "PRIVATE"),
      });
    }
    this.keySelector.setKeys(Array.from(this.keysMap.values()));
    await this.ctx.storage.put<EncryptedKey[]>(this.getStorageKey(), Array.from(this.keysMap.values()));
    for (const row of rows) {
      await db.prepare("UPDATE api_keys SET sync_pending = 0 WHERE id = ?").bind(row.id).run();
    }
  }

  public async loadFromStorage(): Promise<void> {
    this.isLoaded = false;
    await this.ensureLoaded();
  }

  public clearMemoryCache(): void {
    this.keysMap.clear();
    this.leasesMap.clear();
    this.isLoaded = false;
    this.privateReconciled = false;
    this.keySelector.clearMemoryCache();
    this.circuitBreaker.clearMemoryCache();
    this.rateLimiter.clearMemoryCache();
  }

  // =========================================================================
  // Key Pool CRUD Operations
  // =========================================================================

  private validateKeyStructure(key: unknown): asserts key is EncryptedKey {
    if (!isEncryptedKey(key)) {
      throw new InvalidKeyError(
        "Invalid EncryptedKey: id, provider, ciphertext, and nonce are required",
        { provider: (key as Record<string, unknown>)?.provider as string | undefined }
      );
    }
  }

  private addKeySync(key: EncryptedKey): void {
    this.validateKeyStructure(key);
    const isCommunal = key.poolType === "COMMUNITY";
    if (!isCommunal) {
      this.assertTenant(key.tenantId, key.id);
    }

    const safeKey: EncryptedKey = {
      ...key,
      tenantId: key.tenantId && key.tenantId.trim().length > 0 ? key.tenantId : this.tenantId,
    };
    this.keysMap.set(safeKey.id, safeKey);
    this.keySelector.addKey(safeKey);
  }

  private addKeysSync(keys: EncryptedKey[]): void {
    for (const k of keys) {
      this.addKeySync(k);
    }
  }

  public async addKey(key: EncryptedKey): Promise<void> {
    await this.ensureLoaded();
    this.addKeySync(key);
    await this.persistKeys();
  }

  public async addKeys(keys: EncryptedKey[]): Promise<void> {
    await this.ensureLoaded();
    this.addKeysSync(keys);
    await this.persistKeys();
  }

  public async setKeys(keys: EncryptedKey[]): Promise<void> {
    this.keysMap.clear();
    this.addKeysSync(keys);
    this.isLoaded = true;
    await this.persistKeys();
  }

  public async removeKey(keyId: string): Promise<boolean> {
    await this.ensureLoaded();
    const removedFromMap = this.keysMap.delete(keyId);
    const removedFromSelector = this.keySelector.removeKey(keyId);
    if (removedFromMap || removedFromSelector) {
      await this.persistKeys();
      return true;
    }
    return false;
  }

  public async getKeys(provider?: string): Promise<EncryptedKey[]> {
    await this.ensureLoaded();
    const all = Array.from(this.keysMap.values());
    if (!provider || provider === "*") {
      return all.map((k) => ({ ...k }));
    }
    const norm = provider.trim().toLowerCase();
    return all
      .filter((k) => k.provider.trim().toLowerCase() === norm)
      .map((k) => ({ ...k }));
  }

  public async getKeyById(keyId: string): Promise<EncryptedKey | undefined> {
    await this.ensureLoaded();
    const key = this.keysMap.get(keyId);
    return key ? { ...key } : undefined;
  }

  public async hasKey(keyId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.keysMap.has(keyId);
  }

  public async getKeyCount(provider?: string): Promise<number> {
    const keys = await this.getKeys(provider);
    return keys.length;
  }

  public async alarm(): Promise<void> {
    await this.ensureLoaded();
    await this.runNightlyCanaryProbes().catch(() => {});

    const tomorrow = new Date(this.clock.now());
    tomorrow.setUTCHours(24, 0, 0, 0);
    const storageWithAlarm = this.ctx.storage as unknown as {
      setAlarm?: (time: number) => Promise<void>;
    };
    if (typeof storageWithAlarm?.setAlarm === "function") {
      await storageWithAlarm.setAlarm(tomorrow.getTime());
    }
  }

  /**
   * Nightly passive contributor canary (WP-5.9 T-5.9.1):
   * - Asks TenantQuotaDO for the tenant's 24h personal request count.
   * - If < 50, asks the coordinators for the tenant's community keys and runs `checkProofOfLife`
   *   once per key per day: 200 -> HEALTHY; 401/403 -> QUARANTINED + owner notification; 429 -> no action.
   */
  private async runNightlyCanaryProbes(): Promise<void> {
    const now = this.now();
    const todayDay = new Date(now).toISOString().slice(0, 10);

    // 1. Ask TenantQuotaDO for yesterday's (24h) personal request count
    let personalRequests = 0;
    const quotaNs = this.env.TENANT_QUOTA as DurableObjectNamespace | undefined;
    if (quotaNs && typeof quotaNs.idFromName === "function" && typeof quotaNs.get === "function") {
      const quotaStub = quotaNs.get(quotaNs.idFromName(this.tenantId)) as unknown as {
        getPersonalRequestCount?(targetTenantId?: string): Promise<number>;
        getRpd?(): Promise<number> | number;
      };
      if (typeof quotaStub.getPersonalRequestCount === "function") {
        personalRequests = await quotaStub.getPersonalRequestCount(this.tenantId).catch(() => 0);
      } else if (typeof quotaStub.getRpd === "function") {
        personalRequests = Number(await Promise.resolve(quotaStub.getRpd()).catch(() => 0));
      }
    }

    if (personalRequests >= 50) {
      return;
    }

    // 2. Ask the coordinators for the tenant's community keys
    const candidateMap = new Map<string, { keyId: string; provider: string; label?: string }>();
    const coordNs = this.env.POOL_COORDINATOR as DurableObjectNamespace | undefined;

    if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
      for (const prov of ["google", "groq"] as const) {
        const coordStub = coordNs.get(coordNs.idFromName(`pool:${prov}`)) as unknown as {
          getOwnerCommunityKeys?(
            owner: string
          ): Promise<Array<{ keyId: string; provider: string; status: string }>>;
        };
        if (typeof coordStub.getOwnerCommunityKeys === "function") {
          const rows = await coordStub.getOwnerCommunityKeys(this.tenantId).catch(() => []);
          for (const r of rows) {
            candidateMap.set(r.keyId, { keyId: r.keyId, provider: r.provider });
          }
        }
      }
    }

    // Also include any in-memory or D1 community keys owned by this tenant
    for (const k of this.keysMap.values()) {
      if (
        k.tenantId === this.tenantId &&
        k.poolType === "COMMUNITY" &&
        k.status !== "REVOKED"
      ) {
        if (!candidateMap.has(k.id)) {
          candidateMap.set(k.id, { keyId: k.id, provider: k.provider, label: k.label });
        }
      }
    }

    const db = this.env.DB;
    const hasDb = Boolean(db && typeof db.prepare === "function");

    // 3. Run checkProofOfLife once per key per day
    for (const { keyId, provider, label } of candidateMap.values()) {
      const canaryKey = `${this.storageKeyPrefix}canary:${keyId}`;
      const lastProbedDay = await this.ctx.storage.get<string>(canaryKey).catch(() => undefined);
      if (lastProbedDay === todayDay) {
        continue;
      }

      let rawKey: string | undefined;
      if (hasDb) {
        try {
          rawKey = await resolveLeasedKey(
            { keyId, ownerTenantId: this.tenantId, provider },
            this.env as unknown as WorkerEnv
          );
        } catch (err) {
          new Logger({ traceId: "canary-probe", tenantId: this.tenantId }).warn(
            "Failed to resolve leased key during nightly canary probe",
            { keyId, error: err instanceof Error ? err.message : String(err) }
          );
          rawKey = undefined;
        }
      }
      if (!rawKey) {
        const localKey = this.keysMap.get(keyId);
        if (localKey?.ciphertext) {
          rawKey = localKey.ciphertext;
        }
      }
      if (!rawKey) {
        continue;
      }

      const localKeyBefore = this.keysMap.get(keyId);
      let wasAlreadyQuarantined = localKeyBefore?.status === "QUARANTINED";
      let projectHash: string | null = null;
      if (hasDb) {
        const d1KeyBefore = await db!
          .prepare("SELECT status, provider_project_hash FROM api_keys WHERE id = ?")
          .bind(keyId)
          .first<{ status: string; provider_project_hash: string | null }>()
          .catch(() => null);
        if (d1KeyBefore?.status === "QUARANTINED") {
          wasAlreadyQuarantined = true;
        }
        projectHash = d1KeyBefore?.provider_project_hash ?? null;
      }

      await this.ctx.storage.put<string>(canaryKey, todayDay).catch(() => {});

      const probe = await checkProofOfLife(rawKey, provider);
      const canonProv = canonicalCoordinatorProvider(provider);

      if ("ok" in probe && probe.ok) {
        const localKey = this.keysMap.get(keyId);
        if (localKey && localKey.status !== "HEALTHY") {
          localKey.status = "HEALTHY";
          localKey.cooldownUntil = null;
          this.keySelector.addKey(localKey);
          await this.persistKeys();
        }
        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'HEALTHY', status_changed_at = ? WHERE id = ? AND status NOT IN ('REVOKED', 'QUARANTINED')"
            )
            .bind(now, keyId)
            .run()
            .catch(() => {});
        }
      } else if ("error" in probe && probe.error === "key_invalid") {
        if (wasAlreadyQuarantined) {
          // Repeated 401 after canary -> permanent revocation & TOMBSTONED directly (WP-5.11 T-5.11.3)
          if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
            const coordStub = coordNs.get(coordNs.idFromName(`pool:${canonProv}`)) as unknown as {
              removeKey?(keyId: string): Promise<boolean>;
              setStatus?(keyId: string, status: string): Promise<boolean>;
            };
            if (typeof coordStub.removeKey === "function") {
              await coordStub.removeKey(keyId).catch(() => false);
            } else if (typeof coordStub.setStatus === "function") {
              await coordStub.setStatus(keyId, "REVOKED").catch(() => false);
            }
          }

          const localKey = this.keysMap.get(keyId);
          if (localKey) {
            localKey.status = "REVOKED";
            localKey.cooldownUntil = null;
            this.keysMap.delete(keyId);
            this.keySelector.removeKey(keyId);
            await this.persistKeys();
          }

          if (hasDb) {
            await db!
              .prepare(
                "UPDATE api_keys SET status = 'REVOKED', community_routing_status = 'REVOKED', revoked_at = ?, status_changed_at = ? WHERE id = ?"
              )
              .bind(now, now, keyId)
              .run()
              .catch(() => {});

            if (projectHash) {
              await db!
                .prepare(
                  `UPDATE project_hash_registry
                      SET state = 'TOMBSTONED',
                          rotating_until = NULL,
                          tombstone_until = ?,
                          updated_at = ?
                    WHERE project_hash = ?`
                )
                .bind(now + 14 * 86_400_000, now, projectHash)
                .run()
                .catch(() => {});
            }
          }
          continue;
        }

        // First 401 -> Quarantine flow: coordinator, D1 api_keys, local map, and owner notification
        if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
          const coordStub = coordNs.get(coordNs.idFromName(`pool:${canonProv}`)) as unknown as {
            setStatus?(keyId: string, status: string): Promise<boolean>;
          };
          if (typeof coordStub.setStatus === "function") {
            await coordStub.setStatus(keyId, "QUARANTINED").catch(() => false);
          }
        }

        const localKey = this.keysMap.get(keyId);
        if (localKey) {
          localKey.status = "QUARANTINED";
          localKey.cooldownUntil = null;
          this.keySelector.addKey(localKey);
          await this.persistKeys();
        }

        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'QUARANTINED', community_routing_status = 'QUARANTINED', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
            )
            .bind(now, keyId)
            .run()
            .catch(() => {});

          let resolvedLabel = label ?? localKey?.label;
          if (!resolvedLabel) {
            const kRow = await db!
              .prepare("SELECT label FROM api_keys WHERE id = ?")
              .bind(keyId)
              .first<{ label: string }>()
              .catch(() => null);
            resolvedLabel = kRow?.label;
          }

          const notifId = "notif_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const normProv = provider.toLowerCase();
          const provDisplay =
            normProv === "google" || normProv === "gemini"
              ? "Gemini"
              : normProv === "groq"
              ? "Groq"
              : provider;
          const consoleDisplay =
            normProv === "google" || normProv === "gemini"
              ? "Google AI Studio"
              : normProv === "groq"
              ? "Groq Console"
              : `${provDisplay} dashboard`;
          const msg = `⚠️ Key [${resolvedLabel || keyId}] (${provDisplay}) went unhealthy during nightly canary check. Check your ${consoleDisplay} and re-submit if needed.`;

          await db!
            .prepare(
              "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, 'key_invalid', ?, ?, ?, NULL)"
            )
            .bind(notifId, this.tenantId, keyId, msg, now)
            .run()
            .catch(() => {});
        }
      }
      // 429 (key_no_quota) or provider_unavailable -> no action
    }
  }

  /**
   * Public RPC accessor for the DO's current clock timestamp.
   */
  public getNow(): number {
    return this.now();
  }

  /**
   * Test-only RPC: switches this DO to a fixed clock. Throws outside the
   * test environment (env.KC_ENV !== "test").
   */
  public setClockForTest(ms: number): void {
    if (this.env.KC_ENV !== "test") {
      throw new Error("setClockForTest is only available when KC_ENV=test");
    }
    this.clock = { now: () => ms };
  }

  public async clearKeys(): Promise<void> {
    this.keysMap.clear();
    this.keySelector.clearKeys();
    this.isLoaded = true;
    await this.persistKeys();
  }

  // =========================================================================
  // KeyPoolContract Implementation (LLD 3.4)
  // =========================================================================

  public async getKey(provider: string): Promise<string> {
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter cannot be empty");
    }

    await this.ensureLoaded();
    const selected = await this.keySelector.selectKey(provider);
    return selected.id;
  }

  public async recordUsage(
    keyId: string,
    costMicrodollars: bigint
  ): Promise<void> {
    if (!keyId || keyId.trim().length === 0) {
      throw new InvalidKeyError("Key ID cannot be empty");
    }

    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    await this.rateLimiter.increment(keyId, costMicrodollars);
    this.keySelector.recordUsage(keyId);
    this.emitTelemetry("key_usage", keyId, costMicrodollars);
  }

  // =========================================================================
  // Private Lease API (WP-4.1, T-4.1.3)
  // =========================================================================
  /**
   * @deprecated Legacy API — superseded by settle(). No-op stub kept for backwards-compat
   * with the legacy HTTP RPC path (upstream/client.ts). Remove in WP-7.x cleanup.
   */
  public async recordResult(
    _keyId: string,
    _success: boolean
  ): Promise<void> {
    // no-op: new path uses settle() with PrivateLeaseOutcome
  }

  /**
   * @deprecated Legacy API — superseded by settle(). No-op stub kept for backwards-compat
   * with the legacy HTTP RPC path (upstream/client.ts). Remove in WP-7.x cleanup.
   */
  public async recordStatusCode(
    _keyId: string,
    _statusCode: number
  ): Promise<void> {
    // no-op: new path uses settle() with PrivateLeaseOutcome
  }



  /**
   * Sets administrative circuit override pushed from coordinator/admin (WP-4.6, T-4.6.1).
   */
  public async setProviderOverride(
    provider: string,
    state: "TRIPPED" | "NORMAL",
    until?: number
  ): Promise<void> {
    const norm = provider.trim().toLowerCase();
    this.providerOverrides.set(norm, { state, until });
    if (norm === "google") this.providerOverrides.set("gemini", { state, until });
    if (norm === "gemini") this.providerOverrides.set("google", { state, until });
    if (this.ctx.storage && typeof this.ctx.storage.put === "function") {
      await this.ctx.storage.put(`override:${norm}`, { state, until }).catch(() => {});
    }
  }

  /**
   * Gets administrative circuit override for provider (WP-4.6, T-4.6.1).
   */
  public async getProviderOverride(
    provider: string
  ): Promise<{ state: "TRIPPED" | "NORMAL"; until?: number } | null> {
    const norm = provider.trim().toLowerCase();
    let override = this.providerOverrides.get(norm);
    if (!override && this.ctx.storage && typeof this.ctx.storage.get === "function") {
      override = await this.ctx.storage.get<{ state: "TRIPPED" | "NORMAL"; until?: number }>(`override:${norm}`).catch(() => undefined);
      if (override) {
        this.providerOverrides.set(norm, override);
      }
    }
    if (!override) return null;
    if (override.state === "TRIPPED" && override.until && this.now() >= override.until) {
      override = { state: "NORMAL" };
      this.providerOverrides.set(norm, override);
    }
    return override;
  }

  /**
   * Leases one of this tenant's PRIVATE keys (or a D-21 stranded COMMUNITY key when the
   * owner lacks communityPool rights). Applies circuit breaker and per-key RPM/RPD limits.
   */
  public async leasePrivate(
    provider: string,
    estimateCu = 0,
    tenantId?: string
  ): Promise<PrivateKeyLease | null> {
    await this.alarmBootstrapPromise.catch(() => {});
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter cannot be empty");
    }
    if (tenantId) {
      this.assertTenant(tenantId);
    }

    const override = await this.getProviderOverride(provider);
    if (override && override.state === "TRIPPED") {
      return null;
    }

    await this.ensureLoaded();
    if (!this.privateReconciled && this.env.DB && typeof this.env.DB.prepare === "function") {
      await this.reconcile();
    }

    const norm = provider.trim().toLowerCase();
    const matchProvider = (p: string): boolean => {
      const kp = p.trim().toLowerCase();
      if (kp === norm) return true;
      if ((norm === "google" && kp === "gemini") || (norm === "gemini" && kp === "google")) {
        return true;
      }
      return false;
    };

    const now = this.now();
    const candidates: EncryptedKey[] = [];
    let statusRecovered = false;

    for (const k of this.keysMap.values()) {
      if (k.tenantId !== this.tenantId) continue;
      if (!matchProvider(k.provider)) continue;

      const isCommunal = k.poolType === "COMMUNITY";
      if (isCommunal && this.ownerHasCommunityPool) {
        continue;
      }

      if (k.status === "COOLDOWN" && k.cooldownUntil && now >= k.cooldownUntil) {
        k.status = "HEALTHY";
        k.cooldownUntil = null;
        this.keySelector.addKey(k);
        statusRecovered = true;
      }

      candidates.push(k);
    }

    if (statusRecovered) {
      await this.persistKeys();
    }

    if (candidates.length === 0) {
      return null;
    }

    const costBigInt = BigInt(Math.max(0, Math.floor(estimateCu)));
    const selected = await this.keySelector.selectKey(provider, {
      candidateKeys: candidates,
      throwOnExhausted: false,
      costMicrodollars: costBigInt,
    });

    if (!selected) {
      return null;
    }

    await this.rateLimiter.increment(selected.id, 0n);

    const leaseId = "lease_priv_" + crypto.randomUUID();
    const record: PrivateLeaseRecord = {
      leaseId,
      keyId: selected.id,
      provider: selected.provider,
      estimateCu: Math.max(0, Math.floor(estimateCu)),
      createdAt: now,
      settled: false,
    };
    this.leasesMap.set(leaseId, record);
    await this.ctx.storage.put<PrivateLeaseRecord>(this.getLeaseStorageKey(leaseId), record);

    return {
      leaseId,
      keyId: selected.id,
      provider: selected.provider,
      ownerTenantId: this.tenantId,
      source: "private",
    };
  }

  /**
   * Idempotently settles a private key lease and updates circuit breaker / key status.
   */
  public async settle(
    leaseId: string,
    outcome: PrivateLeaseOutcome,
    cu = 0,
    until?: number
  ): Promise<PrivateSettleResult> {
    await this.alarmBootstrapPromise.catch(() => {});
    if (!leaseId || leaseId.trim().length === 0) {
      return { settled: false, duplicate: false };
    }

    await this.ensureLoaded();

    let lease = this.leasesMap.get(leaseId);
    if (!lease) {
      lease = await this.ctx.storage.get<PrivateLeaseRecord>(this.getLeaseStorageKey(leaseId));
      if (lease) {
        this.leasesMap.set(leaseId, lease);
      }
    }

    if (!lease) {
      return { settled: false, duplicate: false };
    }

    if (lease.settled) {
      return { settled: true, duplicate: true };
    }

    const now = this.now();
    lease.settled = true;
    lease.settledAt = now;
    this.leasesMap.set(leaseId, lease);
    await this.ctx.storage.put<PrivateLeaseRecord>(this.getLeaseStorageKey(leaseId), lease);

    const actualCu = Math.max(0, Math.floor(cu));
    if (actualCu > 0) {
      const costBigInt = BigInt(actualCu);
      await this.rateLimiter.recordCostOnly(lease.keyId, costBigInt);
      this.emitTelemetry("key_usage", lease.keyId, costBigInt);
    }

    const key = this.keysMap.get(lease.keyId);
    const db = this.env.DB;
    const hasDb = Boolean(db && typeof db.prepare === "function");
    const resolveUntil = (u: number | undefined, fallbackTargetMs: number): number =>
      u === undefined ? fallbackTargetMs : u < 100_000_000_000 ? now + u : u;

    switch (outcome) {
      case "ok": {
        await this.circuitBreaker.recordSuccess(lease.keyId);
        if (key && key.status === "COOLDOWN") {
          key.status = "HEALTHY";
          key.cooldownUntil = null;
          this.keySelector.addKey(key);
          await this.persistKeys();
        }
        if (hasDb) {
          await db!
            .prepare("UPDATE api_keys SET status = 'HEALTHY', status_changed_at = ? WHERE id = ? AND status = 'COOLDOWN'")
            .bind(now, lease.keyId)
            .run();
        }
        this.emitTelemetry("upstream_success", lease.keyId, 0n, { success: "true" });
        break;
      }

      case "key_invalid": {
        if (key) {
          key.status = "QUARANTINED";
          key.cooldownUntil = null;
          this.keySelector.addKey(key);
          await this.persistKeys();
        }
        if (hasDb) {
          await db!
            .prepare("UPDATE api_keys SET status = 'QUARANTINED', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'")
            .bind(now, lease.keyId)
            .run();

          const notifId = "notif_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const normProv = (key?.provider || "unknown").toLowerCase();
          const provDisplay = normProv === "google" || normProv === "gemini" ? "Gemini" : normProv === "groq" ? "Groq" : (key?.provider || "unknown");
          const consoleDisplay = normProv === "google" || normProv === "gemini" ? "Google AI Studio" : normProv === "groq" ? "Groq Console" : `${provDisplay} dashboard`;
          const msg = `⚠️ Key [${key?.label || lease.keyId}] (${provDisplay}) went unhealthy. Check your ${consoleDisplay} and re-submit if needed.`;

          await db!
            .prepare(
              "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, 'key_invalid', ?, ?, ?, NULL)"
            )
            .bind(notifId, this.tenantId, lease.keyId, msg, now)
            .run()
            .catch(() => {});
        }
        this.emitTelemetry("upstream_failure", lease.keyId, 0n, {
          success: "false",
          outcome: "key_invalid",
        });
        break;
      }

      case "rpd_exhausted": {
        const cooldownUntil = resolveUntil(until, this.nextUtcMidnightMs(now));
        if (key) {
          key.status = "COOLDOWN";
          key.cooldownUntil = cooldownUntil;
          this.keySelector.addKey(key);
          await this.persistKeys();
        }
        if (hasDb) {
          await db!
            .prepare("UPDATE api_keys SET status = 'COOLDOWN', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'")
            .bind(now, lease.keyId)
            .run();
        }
        this.emitTelemetry("upstream_failure", lease.keyId, 0n, {
          success: "false",
          outcome: "rpd_exhausted",
        });
        break;
      }

      case "rpm_limited": {
        const cooldownUntil = resolveUntil(until, now + 60_000);
        if (key) {
          key.status = "COOLDOWN";
          key.cooldownUntil = cooldownUntil;
          this.keySelector.addKey(key);
          await this.persistKeys();
        }
        this.emitTelemetry("upstream_failure", lease.keyId, 0n, {
          success: "false",
          outcome: "rpm_limited",
        });
        break;
      }

      case "upstream_error": {
        await this.circuitBreaker.recordFailure(lease.keyId);
        this.emitTelemetry("upstream_failure", lease.keyId, 0n, {
          success: "false",
          outcome: "upstream_error",
        });
        break;
      }

      case "request_error":
      default:
        break;
    }

    return { settled: true, duplicate: false };
  }

  // =========================================================================
  // Non-Blocking Telemetry (GEMINI.md Invariant)
  // =========================================================================

  private emitTelemetry(
    eventType: string,
    keyId: string,
    costMicrodollars: bigint = 0n,
    metadata?: Record<string, string>
  ): void {
    const key = this.keysMap.get(keyId);
    const provider = key?.provider ?? "unknown";
    const timestamp = this.now();

    if (this.telemetryEmitter) {
      try {
        const event: TelemetryEvent = {
          traceId: crypto.randomUUID(),
          tenantId: this.tenantId,
          timestamp,
          eventType,
          latencyMs: 0,
          costMicrodollars,
          metadata: {
            keyId,
            provider,
            ...metadata,
          },
        };
        this.telemetryEmitter.emit(event);
      } catch {
        // Non-blocking telemetry invariant: suppress errors
      }
    }

    if (this.env.TELEMETRY && typeof this.env.TELEMETRY.writeDataPoint === "function") {
      try {
        this.env.TELEMETRY.writeDataPoint({
          blobs: [this.tenantId, keyId, provider, eventType],
          doubles: [Number(costMicrodollars), timestamp],
          indexes: [this.tenantId],
        });
      } catch {
        // Non-blocking telemetry invariant: suppress errors
      }
    }
  }

  // =========================================================================
  // Metrics & Capacity Reporting
  // =========================================================================

  public async getKeyMetrics(keyId: string): Promise<KeyMetrics> {
    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    return this.keySelector.getKeyMetrics(keyId);
  }

  public async getCapacitySummary(provider?: string): Promise<CapacitySummary> {
    await this.ensureLoaded();
    return this.keySelector.getCapacitySummary(provider);
  }

  public async getCircuitBreakerState(
    keyId: string
  ): Promise<CircuitBreakerState> {
    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    return this.circuitBreaker.getState(keyId);
  }

  public async getRateLimiterMetrics(
    keyId: string
  ): Promise<RateLimiterMetrics> {
    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    return this.rateLimiter.getMetrics(keyId);
  }

  public async resetKeyCircuitBreaker(keyId: string): Promise<void> {
    await this.ensureLoaded();
    await this.circuitBreaker.reset(keyId);
  }

  public async resetKeyRateLimit(keyId: string): Promise<void> {
    await this.ensureLoaded();
    await this.rateLimiter.reset(keyId);
  }

  // =========================================================================
  // Cloudflare DO Fetch Interface (HTTP RPC)
  // =========================================================================

  public async fetch(request: Request): Promise<Response> {
    await this.alarmBootstrapPromise.catch(() => {});
    const url = new URL(request.url);
    if (url.pathname === "/__test__/clock") {
      if (request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { ms?: number };
        this.setClockForTest(Number(body.ms));
      }
      const alarmStorage = this.ctx.storage as unknown as {
        getAlarm?(): Promise<number | null>;
      };
      const alarm =
        typeof alarmStorage?.getAlarm === "function" ? await alarmStorage.getAlarm() : null;
      return Response.json({ now: this.now(), alarm });
    }

    return new Response("Not Found", { status: 404 });
  }
}
