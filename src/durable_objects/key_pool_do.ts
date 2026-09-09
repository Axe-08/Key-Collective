/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPoolDO — Per-Tenant Stateful Durable Object Pool
 *
 * Conforms to LLD 3.4 & T-04:
 * - Implements KeyPoolContract (getKey, recordUsage, recordResult) and DurableObject.
 * - Enforces Strict Per-Tenant DO Isolation (GEMINI.md Invariant):
 *   Each KeyPoolDO instance owns exactly one tenant pool.
 *   Cross-tenant access triggers TenantIsolationError (HTTP 403).
 * - Fixed-Point Microdollars: All costs in int64/bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - No Plaintext Keys: Operates solely on EncryptedKey records (AES-256-GCM ciphertext + 12-byte nonce).
 * - DO Transactional Storage for Hot State: In-memory keys, circuit breaker, and RPM counters sync to this.ctx.storage.
 * - Non-Blocking Telemetry: Streams metrics to Cloudflare Workers Analytics Engine without blocking hot path.
 * - Full HTTP fetch RPC interface for Worker-to-DO routing.
 */

import {
  EncryptedKey,
  KeyMetrics,
  KeyPoolContract,
} from "../contracts/key_pool";
import { TelemetryContract, TelemetryEvent } from "../contracts/telemetry";
import { TenantIsolationError } from "../errors/auth_errors";
import { DomainError } from "../errors/domain_error";
import {
  InvalidKeyError,
  KeyNotFoundError,
} from "../errors/key_errors";
import {
  CircuitBreaker,
  CircuitBreakerState,
  DurableObjectStorageLike,
} from "./circuit_breaker";

export type { DurableObjectStorageLike } from "./circuit_breaker";
import {
  CapacitySummary,
  KeySelector,
  SelectKeyOptions,
} from "./key_selector";
import { RateLimiter, RateLimiterMetrics } from "./rate_limiter";

/**
 * Environment bindings accessible inside KeyPoolDO.
 */
export interface KeyPoolDOEnv {
  KEY_POOL?: DurableObjectNamespace;
  DB?: D1Database;
  TELEMETRY?: AnalyticsEngineDataset;
  [key: string]: unknown;
}

/**
 * Configuration options for KeyPoolDO instantiation or testing.
 */
export interface KeyPoolDOOptions {
  /** Explicit tenant ID override */
  tenantId?: string;
  /** Initial pool of encrypted keys */
  keys?: EncryptedKey[];
  /** Optional injectable CircuitBreaker */
  circuitBreaker?: CircuitBreaker;
  /** Optional injectable RateLimiter */
  rateLimiter?: RateLimiter;
  /** Optional injectable KeySelector */
  keySelector?: KeySelector<EncryptedKey>;
  /** Optional injectable TelemetryContract */
  telemetryEmitter?: TelemetryContract;
  /** Injectable time provider for deterministic testing */
  timeProvider?: () => number;
}

/**
 * Minimal state required from Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Type guard for EncryptedKey.
 */
export function isEncryptedKey(value: unknown): value is EncryptedKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.provider === "string" &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.ciphertext === "string" &&
    candidate.ciphertext.trim().length > 0 &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.trim().length > 0
  );
}

/**
 * KeyPoolDO — Stateful Per-Tenant Durable Object.
 * Single source of truth for key health, rate limits, and selection within a tenant.
 */
export class KeyPoolDO implements DurableObject, KeyPoolContract {
  protected readonly ctx: DurableObjectStateLike;
  protected readonly env: KeyPoolDOEnv;
  public readonly tenantId: string;
  private readonly storageKeyPrefix = "pool:";
  private readonly timeProvider: () => number;

  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private keySelector: KeySelector<EncryptedKey>;
  private telemetryEmitter?: TelemetryContract;

  private isLoaded = false;
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
    // 1. Explicit in options
    // 2. From ctx.id.name (Cloudflare env.KEY_POOL.idFromName(tenantId))
    // 3. Fallback to ctx.id.toString()
    const resolvedTenant =
      options?.tenantId ??
      this.ctx.id.name ??
      (this.ctx.id.toString ? this.ctx.id.toString() : "default");

    if (!resolvedTenant || resolvedTenant.trim().length === 0) {
      throw new TenantIsolationError("KeyPoolDO requires a non-empty tenantId");
    }
    this.tenantId = resolvedTenant;

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

    if (options?.keys && options.keys.length > 0) {
      this.addKeysSync(options.keys);
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
  // Tenant Isolation Enforcement (GEMINI.md Invariant)
  // =========================================================================

  /**
   * Asserts that a target tenant ID matches this DO instance's tenant.
   * Throws TenantIsolationError if there is any mismatch.
   */
  public assertTenant(targetTenantId?: string, resourceId?: string): void {
    if (!targetTenantId) {
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

  /**
   * Storage key for persisted key pool array.
   */
  private getStorageKey(): string {
    return `${this.storageKeyPrefix}keys`;
  }

  /**
   * Storage key for tenant metadata.
   */
  private getTenantStorageKey(): string {
    return `${this.storageKeyPrefix}tenantId`;
  }

  /**
   * Persists all keys in memory to DO transactional storage.
   */
  private async persistKeys(): Promise<void> {
    const keysArray = Array.from(this.keysMap.values());
    await this.ctx.storage.put<EncryptedKey[]>(this.getStorageKey(), keysArray);
    await this.ctx.storage.put<string>(this.getTenantStorageKey(), this.tenantId);
  }

  /**
   * Ensures that hot state is loaded from DO transactional storage.
   */
  public async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
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

    this.isLoaded = true;
  }

  /**
   * Explicitly loads keys from DO transactional storage.
   */
  public async loadFromStorage(): Promise<void> {
    this.isLoaded = false;
    await this.ensureLoaded();
  }

  /**
   * Clears in-memory caches to simulate DO instance eviction.
   * State is preserved in DO transactional storage.
   */
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

  /**
   * Validates an EncryptedKey structure.
   */
  private validateKeyStructure(key: unknown): asserts key is EncryptedKey {
    if (!isEncryptedKey(key)) {
      throw new InvalidKeyError(
        "Invalid EncryptedKey: id, provider, ciphertext, and nonce are required",
        { provider: (key as Record<string, unknown>)?.provider as string | undefined }
      );
    }
  }

  /**
   * Synchronous key addition (internal).
   */
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

  /**
   * Synchronous bulk key addition (internal).
   */
  private addKeysSync(keys: EncryptedKey[]): void {
    for (const k of keys) {
      this.addKeySync(k);
    }
  }

  /**
   * Adds or updates a single key in the pool and syncs to DO storage.
   */
  public async addKey(key: EncryptedKey): Promise<void> {
    await this.ensureLoaded();
    this.addKeySync(key);
    await this.persistKeys();
  }

  /**
   * Adds or updates multiple keys in the pool and syncs to DO storage.
   */
  public async addKeys(keys: EncryptedKey[]): Promise<void> {
    await this.ensureLoaded();
    this.addKeysSync(keys);
    await this.persistKeys();
  }

  /**
   * Replaces all keys in the pool and syncs to DO storage.
   */
  public async setKeys(keys: EncryptedKey[]): Promise<void> {
    this.keysMap.clear();
    this.addKeysSync(keys);
    this.isLoaded = true;
    await this.persistKeys();
  }

  /**
   * Removes a key by ID and syncs to DO storage.
   */
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

  /**
   * Retrieves all keys, optionally filtered by provider.
   */
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

  /**
   * Retrieves a single key by ID.
   */
  public async getKeyById(keyId: string): Promise<EncryptedKey | undefined> {
    await this.ensureLoaded();
    const key = this.keysMap.get(keyId);
    return key ? { ...key } : undefined;
  }

  /**
   * Checks if a key ID exists in the pool.
   */
  public async hasKey(keyId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.keysMap.has(keyId);
  }

  /**
   * Returns key count, optionally filtered by provider.
   */
  public async getKeyCount(provider?: string): Promise<number> {
    const keys = await this.getKeys(provider);
    return keys.length;
  }

  /**
   * Clears all keys from the pool and syncs to DO storage.
   */
  public async clearKeys(): Promise<void> {
    this.keysMap.clear();
    this.keySelector.clearKeys();
    this.isLoaded = true;
    await this.persistKeys();
  }

  // =========================================================================
  // KeyPoolContract Implementation (LLD 3.4)
  // =========================================================================

  /**
   * KeyPoolContract: getKey(provider: string)
   * Coordinates with KeySelector to yield an available, healthy key ID.
   *
   * @param provider - Target model provider (e.g. "openai", "anthropic", "gemini")
   * @returns Selected key ID string
   * @throws KeyExhaustedError if all keys are exhausted, rate limited, or circuit broken
   */
  public async getKey(provider: string): Promise<string> {
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter cannot be empty");
    }

    await this.ensureLoaded();

    const selected = await this.keySelector.selectKey(provider);
    return selected.id;
  }

  /**
   * Detailed key selection yielding full EncryptedKey record.
   */
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

  /**
   * KeyPoolContract: recordUsage(keyId: string, costMicrodollars: bigint)
   * Updates RateLimiter sliding counters, KeySelector invocation counts, and emits telemetry.
   *
   * @param keyId - Target key identifier
   * @param costMicrodollars - Request cost in fixed-point microdollars (bigint)
   */
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

    // 1. Update RateLimiter sliding window
    await this.rateLimiter.increment(keyId, costMicrodollars);

    // 2. Update KeySelector usage counter
    this.keySelector.recordUsage(keyId);

    // 3. Emit non-blocking telemetry
    this.emitTelemetry("key_usage", keyId, costMicrodollars);
  }

  /**
   * KeyPoolContract: recordResult(keyId: string, success: boolean)
   * Informs CircuitBreaker of upstream call success or failure (LLD 3.4).
   *
   * @param keyId - Target key identifier
   * @param success - True if operation succeeded, false if upstream failure
   */
  public async recordResult(keyId: string, success: boolean): Promise<void> {
    if (!keyId || keyId.trim().length === 0) {
      throw new InvalidKeyError("Key ID cannot be empty");
    }

    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    // 1. Inform CircuitBreaker
    await this.circuitBreaker.recordResult(keyId, success);

    // 2. Emit non-blocking telemetry
    this.emitTelemetry(
      success ? "upstream_success" : "upstream_failure",
      keyId,
      0n,
      { success: String(success) }
    );
  }

  /**
   * Informs CircuitBreaker of upstream HTTP status code (e.g., 429, 500).
   */
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

  /**
   * Emits telemetry to Cloudflare Workers Analytics Engine and/or injected TelemetryContract.
   * NEVER blocks the hot path and never throws errors.
   */
  private emitTelemetry(
    eventType: string,
    keyId: string,
    costMicrodollars: bigint = 0n,
    metadata?: Record<string, string>
  ): void {
    const key = this.keysMap.get(keyId);
    const provider = key?.provider ?? "unknown";
    const timestamp = this.now();

    // 1. Injected TelemetryContract
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

    // 2. Workers Analytics Engine Dataset
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

  /**
   * Returns KeyMetrics for a key ID, conforming to KeyPoolContract.
   */
  public async getKeyMetrics(keyId: string): Promise<KeyMetrics> {
    await this.ensureLoaded();

    const key = this.keysMap.get(keyId);
    if (!key) {
      throw new KeyNotFoundError(keyId, undefined, { tenantId: this.tenantId });
    }

    return this.keySelector.getKeyMetrics(keyId);
  }

  /**
   * Returns comprehensive capacity summary for a provider or the tenant pool.
   */
  public async getCapacitySummary(provider?: string): Promise<CapacitySummary> {
    await this.ensureLoaded();
    return this.keySelector.getCapacitySummary(provider);
  }

  /**
   * Returns current CircuitBreaker state for a key.
   */
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

  /**
   * Returns RateLimiter metrics snapshot for a key.
   */
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

  /**
   * Resets CircuitBreaker for a key to CLOSED state.
   */
  public async resetKeyCircuitBreaker(keyId: string): Promise<void> {
    await this.ensureLoaded();
    await this.circuitBreaker.reset(keyId);
  }

  /**
   * Resets RateLimiter counters for a key.
   */
  public async resetKeyRateLimit(keyId: string): Promise<void> {
    await this.ensureLoaded();
    await this.rateLimiter.reset(keyId);
  }

  // =========================================================================
  // Cloudflare DO Fetch Interface (HTTP RPC)
  // =========================================================================

  /**
   * Handles incoming HTTP requests to the Durable Object.
   * Enables Worker-to-DO RPC via fetch.
   */
  public async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      // Tenant isolation validation via header
      const headerTenant = request.headers.get("x-tenant-id");
      if (headerTenant) {
        this.assertTenant(headerTenant);
      }

      // 1. Health check
      if (url.pathname === "/health") {
        await this.ensureLoaded();
        return Response.json({
          status: "healthy",
          do: true,
          tenantId: this.tenantId,
          keyCount: this.keysMap.size,
          timestamp: new Date(this.now()).toISOString(),
        });
      }

      // 2. Select key: POST /keys/get or GET /key
      if (
        (method === "POST" && url.pathname === "/keys/get") ||
        (method === "GET" && url.pathname === "/key")
      ) {
        let provider: string | null = url.searchParams.get("provider");
        if (method === "POST") {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          if (body.tenantId) {
            this.assertTenant(body.tenantId as string);
          }
          if (typeof body.provider === "string") {
            provider = body.provider;
          }
        }

        if (!provider) {
          throw new InvalidKeyError("Provider parameter is required");
        }

        const keyId = await this.getKey(provider);
        const keyDetails = await this.getKeyById(keyId);

        return Response.json({
          keyId,
          key: keyDetails,
        });
      }

      // 3. Record usage: POST /keys/usage
      if (method === "POST" && url.pathname === "/keys/usage") {
        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (body.tenantId) {
          this.assertTenant(body.tenantId as string);
        }

        const keyId = body.keyId as string;
        const costStr = body.costMicrodollars;
        const cost =
          typeof costStr === "bigint"
            ? costStr
            : typeof costStr === "number"
            ? BigInt(Math.floor(costStr))
            : typeof costStr === "string"
            ? BigInt(costStr)
            : 0n;

        await this.recordUsage(keyId, cost);
        return Response.json({ success: true, keyId, cost: cost.toString() });
      }

      // 4. Record result: POST /keys/result
      if (method === "POST" && url.pathname === "/keys/result") {
        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (body.tenantId) {
          this.assertTenant(body.tenantId as string);
        }

        const keyId = body.keyId as string;
        const success = Boolean(body.success);

        await this.recordResult(keyId, success);
        return Response.json({ success: true, keyId, recordedSuccess: success });
      }

      // 5. Record status code: POST /keys/status-code
      if (method === "POST" && url.pathname === "/keys/status-code") {
        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (body.tenantId) {
          this.assertTenant(body.tenantId as string);
        }

        const keyId = body.keyId as string;
        const statusCode = Number(body.statusCode ?? 500);

        await this.recordStatusCode(keyId, statusCode);
        return Response.json({ success: true, keyId, statusCode });
      }

      // 6. List keys: GET /keys
      if (method === "GET" && url.pathname === "/keys") {
        const provider = url.searchParams.get("provider") ?? undefined;
        const keys = await this.getKeys(provider);
        return Response.json({ keys, count: keys.length });
      }

      // 7. Add or update key: POST /keys
      if (method === "POST" && url.pathname === "/keys") {
        const body = (await request.json()) as Record<string, unknown>;
        if (Array.isArray(body.keys)) {
          await this.addKeys(body.keys as EncryptedKey[]);
          return Response.json({ success: true, addedCount: body.keys.length });
        } else if (body.key) {
          await this.addKey(body.key as EncryptedKey);
          return Response.json({ success: true });
        } else if (isEncryptedKey(body)) {
          await this.addKey(body);
          return Response.json({ success: true });
        }
        throw new InvalidKeyError("Invalid key payload");
      }

      // 8. Replace keys: PUT /keys
      if (method === "PUT" && url.pathname === "/keys") {
        const body = (await request.json()) as { keys?: EncryptedKey[] };
        if (Array.isArray(body.keys)) {
          await this.setKeys(body.keys);
          return Response.json({ success: true, count: body.keys.length });
        }
        throw new InvalidKeyError("PUT /keys requires a 'keys' array");
      }

      // 9. Remove key: DELETE /keys/:id or DELETE /keys?keyId=...
      if (method === "DELETE" && url.pathname.startsWith("/keys")) {
        const parts = url.pathname.split("/");
        const keyId = parts[2] || url.searchParams.get("keyId");
        if (!keyId) {
          throw new InvalidKeyError("Key ID is required for deletion");
        }
        const removed = await this.removeKey(keyId);
        return Response.json({ success: true, removed, keyId });
      }

      // 10. Metrics: GET /metrics
      if (method === "GET" && url.pathname === "/metrics") {
        const keyId = url.searchParams.get("keyId");
        if (!keyId) {
          throw new InvalidKeyError("Key ID is required for /metrics");
        }
        const metrics = await this.getKeyMetrics(keyId);
        return Response.json({
          metrics: {
            ...metrics,
            costAccumulatedMicrodollars:
              metrics.costAccumulatedMicrodollars.toString(),
          },
        });
      }

      // 11. Capacity summary: GET /capacity
      if (method === "GET" && url.pathname === "/capacity") {
        const provider = url.searchParams.get("provider") ?? undefined;
        const capacity = await this.getCapacitySummary(provider);
        return Response.json({ capacity });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: unknown) {
      if (err instanceof DomainError) {
        return err.toResponse();
      }
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  }
}
