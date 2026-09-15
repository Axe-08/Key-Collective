/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPoolDO — Per-Tenant Stateful Durable Object Pool
 */

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
  SelectKeyOptions,
} from "../key_selector";
import { RateLimiter, RateLimiterMetrics } from "../rate_limiter";
import { handleKeyPoolRpc } from "./rpc";
import {
  DurableObjectStateLike,
  isEncryptedKey,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
} from "./types";

/**
 * KeyPoolDO — Stateful Per-Tenant Durable Object.
 * Single source of truth for key health, rate limits, and selection within a tenant.
 */
export class KeyPoolDO implements DurableObject, KeyPoolContract {
  protected readonly ctx: DurableObjectStateLike;
  protected readonly env: KeyPoolDOEnv;
  public tenantId: string;
  private readonly storageKeyPrefix = "pool:";
  private readonly timeProvider: () => number;

  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private keySelector: KeySelector<EncryptedKey>;
  private telemetryEmitter?: TelemetryContract;

  private isLoaded = false;

  private dispatchedToday = new Map<string, number>();
  private dispatchedCommunal = new Map<string, number>();
  private readonly keysMap = new Map<string, EncryptedKey>();

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: KeyPoolDOEnv,
    options?: KeyPoolDOOptions
  ) {
    this.ctx = ctx as DurableObjectStateLike;
    this.env = env ?? {};
    this.timeProvider = options?.timeProvider ?? (() => Date.now());

    // Resolve tenant ID strictly:
    const resolvedTenant =
      options?.tenantId ??
      this.ctx.id.name ??
      (this.ctx.id.toString ? this.ctx.id.toString() : "default");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("KeyPoolDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;

    (this.ctx.storage as any).getAlarm().then((alarm: number | null) => {
      if (!alarm) {
        const tomorrow = new Date(Date.now());
        tomorrow.setUTCHours(24, 0, 0, 0);
        (this.ctx.storage as any).setAlarm(tomorrow.getTime());
      }
    });

    // Initialize dependencies
    this.circuitBreaker =
      options?.circuitBreaker ??
      new CircuitBreaker(this.ctx.storage, {
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
        circuitBreaker: this.circuitBreaker,
        rateLimiter: this.rateLimiter,
        storage: this.ctx.storage,
        timeProvider: this.timeProvider,
      });

    this.telemetryEmitter = options?.telemetryEmitter;

    // Pre-populate keys if provided
    if (options?.keys && options.keys.length > 0) {
      for (const k of options.keys) {
        this.assertTenant(k.tenantId, k.id);
        this.keysMap.set(k.id, { ...k, tenantId: this.tenantId });
      }
      this.keySelector.setKeys(Array.from(this.keysMap.values()));
      this.isLoaded = true;
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
    if (this.tenantId === this.ctx.id.toString()) {
      this.tenantId = targetTenantId;
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

  public async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    const savedTenant = await this.ctx.storage.get<string>(this.getTenantStorageKey());
    if (savedTenant && this.tenantId === this.ctx.id.toString()) {
      this.tenantId = savedTenant;
    }

    const storedKeys = await this.ctx.storage.get<EncryptedKey[]>(
      this.getStorageKey()
    );

    if (storedKeys && Array.isArray(storedKeys)) {
      for (const k of storedKeys) {
        if (isEncryptedKey(k)) {
          this.assertTenant(k.tenantId, k.id);
          this.keysMap.set(k.id, { ...k, tenantId: this.tenantId });
        }
      }
      this.keySelector.setKeys(Array.from(this.keysMap.values()));
    }

    if (this.keysMap.size === 0 && this.env.DB && typeof this.env.DB.prepare === "function") {
      try {
        const stmt = this.env.DB.prepare(
          "SELECT id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, rpm_limit, rpd_limit, priority, status FROM api_keys WHERE tenant_id = ? AND status = 'Healthy'"
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
        }>();
        if (result.results && result.results.length > 0) {
          const d1Keys: EncryptedKey[] = result.results.map((row) => ({
            id: row.id,
            tenantId: this.tenantId,
            provider: row.provider,
            ciphertext: row.encrypted_key_b64,
            nonce: row.nonce_b64,
            label: row.label,
            priority: row.priority,
            rpmLimit: row.rpm_limit,
            rpdLimit: row.rpd_limit,
            status: row.status,
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

    this.isLoaded = true;
  }

  public async loadFromStorage(): Promise<void> {
    this.isLoaded = false;
    await this.ensureLoaded();
  }

  public clearMemoryCache(): void {
    this.keysMap.clear();
    this.isLoaded = false;
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
    this.assertTenant(key.tenantId, key.id);

    const safeKey: EncryptedKey = {
      ...key,
      tenantId: this.tenantId,
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

  public recordDispatch(keyId: string, isCommunal: boolean): void {
    const today = this.dispatchedToday.get(keyId) || 0;
    this.dispatchedToday.set(keyId, today + 1);

    if (isCommunal) {
      const communal = this.dispatchedCommunal.get(keyId) || 0;
      this.dispatchedCommunal.set(keyId, communal + 1);
    }
  }

  public async alarm(): Promise<void> {
    for (const keyId of this.dispatchedToday.keys()) {
      const total = this.dispatchedToday.get(keyId) || 0;
      const communal = this.dispatchedCommunal.get(keyId) || 0;

      if (total > 0) {
        const ratio = communal / total;
        let classification = "NORMAL";
        if (ratio >= 0.8) classification = "HERO";
        else if (ratio < 0.1) classification = "PARASITE";

        this.emitTelemetry("key_classification", keyId, 0n, {
          classification,
          ratio: String(ratio),
        });
      }
    }

    this.dispatchedToday.clear();
    this.dispatchedCommunal.clear();

    const tomorrow = new Date(Date.now());
    tomorrow.setUTCHours(24, 0, 0, 0);
    await (this.ctx.storage as any).setAlarm(tomorrow.getTime());
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

  public async getKeyDetails(
    provider: string,
    options?: SelectKeyOptions<EncryptedKey>
  ): Promise<EncryptedKey> {
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter cannot be empty");
    }

    await this.ensureLoaded();

    const selected = await this.keySelector.selectKey(provider, options);
    return { ...selected };
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

  public async recordResult(keyId: string, success: boolean): Promise<void> {
    if (!keyId || keyId.trim().length === 0) {
      throw new InvalidKeyError("Key ID cannot be empty");
    }

    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    await this.circuitBreaker.recordResult(keyId, success);
    this.emitTelemetry(
      success ? "upstream_success" : "upstream_failure",
      keyId,
      0n,
      { success: String(success) }
    );
  }

  public async recordStatusCode(
    keyId: string,
    statusCode: number
  ): Promise<void> {
    if (!keyId || keyId.trim().length === 0) {
      throw new InvalidKeyError("Key ID cannot be empty");
    }

    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    await this.circuitBreaker.recordStatusCode(keyId, statusCode);

    this.emitTelemetry("upstream_status_code", keyId, 0n, {
      statusCode: String(statusCode),
    });
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
    return handleKeyPoolRpc(request, {
      tenantId: this.tenantId,
      assertTenant: (t) => this.assertTenant(t),
      ensureLoaded: () => this.ensureLoaded(),
      getKey: (p) => this.getKey(p),
      getKeyById: (id) => this.getKeyById(id),
      recordUsage: (id, c) => this.recordUsage(id, c),
      recordResult: (id, s) => this.recordResult(id, s),
      recordStatusCode: (id, sc) => this.recordStatusCode(id, sc),
      getKeys: (p) => this.getKeys(p),
      addKey: (k) => this.addKey(k),
      addKeys: (ks) => this.addKeys(ks),
      setKeys: (ks) => this.setKeys(ks),
      removeKey: (id) => this.removeKey(id),
      getKeyMetrics: (id) => this.getKeyMetrics(id),
      getCapacitySummary: (p) => this.getCapacitySummary(p),
      now: () => this.now(),
      keysCount: () => this.keysMap.size,
    });
  }
}
