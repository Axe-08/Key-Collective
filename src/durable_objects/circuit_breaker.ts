/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * CircuitBreaker State Machine for Cloudflare Durable Objects
 *
 * Conforms to LLD 3.1:
 * - State Machine: Transitions between CLOSED (healthy), OPEN (failing), and HALF_OPEN (testing recovery).
 * - Storage: Persists state and timestamps to DO transactional storage (survives DO eviction).
 * - Contract: trip(), reset(), canExecute().
 * - Result recording: recordResult(keyId, success), recordSuccess(keyId), recordFailure(keyId).
 *
 * Invariants (GEMINI.md):
 * - Strict TypeScript (no `any`).
 * - DO Transactional Storage for Hot State: In-memory circuit breaker syncs to this.ctx.storage.
 * - Zero floating-point math.
 */

import {
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES,
} from "../constants/limits";
import { CircuitBreakerTrippedError } from "../errors/routing_errors";
import { CircuitBreakerConfig } from "../types/config";

/**
 * Circuit breaker states conforming to standard state machine specification.
 */
export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const CIRCUIT_BREAKER_STATES: readonly CircuitBreakerState[] = [
  "CLOSED",
  "OPEN",
  "HALF_OPEN",
] as const;

/**
 * Hot state persisted in DO transactional storage and cached in memory.
 */
export interface CircuitBreakerData {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  openedAt: number | null;
}

/**
 * Configuration options for the CircuitBreaker instance.
 */
export interface CircuitBreakerOptions {
  /** Optional key identifier if bound to a specific provider key */
  keyId?: string;
  /** Consecutive failures before tripping to OPEN (defaults to 3) */
  failureThreshold?: number;
  /** Cooldown duration in seconds before testing HALF_OPEN (defaults to 60s) */
  cooldownSeconds?: number;
  /** Successful probe requests in HALF_OPEN to close the circuit (defaults to 1) */
  halfOpenSuccessThreshold?: number;
  /** Upstream HTTP status codes considered failures (defaults to [429, 500, 502, 503, 504]) */
  trippingStatusCodes?: readonly number[] | number[];
  /** Storage key prefix in DO storage (defaults to "cb:") */
  storageKeyPrefix?: string;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Minimal storage contract required by CircuitBreaker.
 * Satisfied natively by Cloudflare Workers DurableObjectStorage.
 */
export interface DurableObjectStorageLike {
  get<T = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<T | undefined>;
  get<T = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, T>>;
  put<T>(
    key: string,
    value: T,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<T>(
    entries: Record<string, T>,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  delete?(
    key: string,
    options?: DurableObjectPutOptions
  ): Promise<boolean>;
  delete?(
    keys: string[],
    options?: DurableObjectPutOptions
  ): Promise<number>;
  deleteAll?(options?: DurableObjectPutOptions): Promise<void>;
  list?<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>>;
}

/**
 * Default initial circuit breaker data.
 */
export function createDefaultCircuitBreakerData(): CircuitBreakerData {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastFailureTime: null,
    lastSuccessTime: null,
    openedAt: null,
  };
}

/**
 * Type guard for CircuitBreakerState.
 */
export function isCircuitBreakerState(value: unknown): value is CircuitBreakerState {
  return (
    typeof value === "string" &&
    (CIRCUIT_BREAKER_STATES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for CircuitBreakerData.
 */
export function isCircuitBreakerData(value: unknown): value is CircuitBreakerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isCircuitBreakerState(candidate.state) &&
    typeof candidate.consecutiveFailures === "number" &&
    typeof candidate.consecutiveSuccesses === "number" &&
    (candidate.lastFailureTime === null || typeof candidate.lastFailureTime === "number") &&
    (candidate.lastSuccessTime === null || typeof candidate.lastSuccessTime === "number") &&
    (candidate.openedAt === null || typeof candidate.openedAt === "number")
  );
}

/**
 * CircuitBreaker state machine implementation.
 * Manages per-key or pooled health state with DO transactional storage write-through.
 */
export class CircuitBreaker {
  private readonly storage: DurableObjectStorageLike;
  private readonly defaultKeyId: string;
  public readonly failureThreshold: number;
  public readonly cooldownSeconds: number;
  public readonly cooldownMs: number;
  public readonly halfOpenSuccessThreshold: number;
  public readonly trippingStatusCodes: readonly number[];
  private readonly storageKeyPrefix: string;
  private readonly timeProvider: () => number;

  /**
   * In-memory cache of circuit breaker data per keyId.
   * Synced to `storage` on every mutation to survive DO eviction.
   */
  private readonly memory = new Map<string, CircuitBreakerData>();

  constructor(
    storage: DurableObjectStorageLike,
    options?: CircuitBreakerOptions | Partial<CircuitBreakerConfig>
  ) {
    this.storage = storage;
    const opts = options as CircuitBreakerOptions | undefined;
    this.defaultKeyId = opts?.keyId ?? "default";
    this.failureThreshold =
      opts?.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
    this.cooldownSeconds =
      opts?.cooldownSeconds ?? DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS;
    this.cooldownMs = this.cooldownSeconds * 1000;
    this.halfOpenSuccessThreshold =
      opts?.halfOpenSuccessThreshold ??
      DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD;
    this.trippingStatusCodes =
      opts?.trippingStatusCodes ??
      DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES;
    this.storageKeyPrefix = opts?.storageKeyPrefix ?? "cb:";
    this.timeProvider = opts?.timeProvider ?? (() => Date.now());
  }

  /**
   * Current timestamp in milliseconds.
   */
  private now(): number {
    return this.timeProvider();
  }

  /**
   * Storage key for a specific key ID.
   */
  public getStorageKey(keyId?: string): string {
    const id = keyId ?? this.defaultKeyId;
    return `${this.storageKeyPrefix}${id}`;
  }

  /**
   * Resolves target keyId.
   */
  private resolveKeyId(keyId?: string): string {
    return keyId ?? this.defaultKeyId;
  }

  /**
   * Evaluates if cooldown has expired for an OPEN breaker.
   * If expired, transitions state in-place to HALF_OPEN and returns true.
   */
  private evaluateCooldown(data: CircuitBreakerData): boolean {
    if (data.state === "OPEN" && data.openedAt !== null) {
      const elapsed = this.now() - data.openedAt;
      if (elapsed >= this.cooldownMs) {
        data.state = "HALF_OPEN";
        data.consecutiveSuccesses = 0;
        return true;
      }
    }
    return false;
  }

  /**
   * Loads circuit breaker data from memory or DO storage.
   * Ensures write-through sync if cooldown transition occurred.
   */
  public async getData(keyId?: string): Promise<CircuitBreakerData> {
    const id = this.resolveKeyId(keyId);
    let data = this.memory.get(id);

    if (!data) {
      const storageKey = this.getStorageKey(id);
      const stored = await this.storage.get<CircuitBreakerData>(storageKey);

      if (stored && isCircuitBreakerData(stored)) {
        data = { ...stored };
      } else {
        data = createDefaultCircuitBreakerData();
      }
      this.memory.set(id, data);
    }

    if (this.evaluateCooldown(data)) {
      await this.persist(id, data);
    }

    return { ...data };
  }

  /**
   * Synchronous getter for in-memory data (does not await storage).
   */
  public getDataSync(keyId?: string): CircuitBreakerData | undefined {
    const id = this.resolveKeyId(keyId);
    const data = this.memory.get(id);
    if (data) {
      this.evaluateCooldown(data);
      return { ...data };
    }
    return undefined;
  }

  /**
   * Persists circuit breaker state to DO transactional storage.
   */
  private async persist(keyId: string, data: CircuitBreakerData): Promise<void> {
    const storageKey = this.getStorageKey(keyId);
    await this.storage.put<CircuitBreakerData>(storageKey, { ...data });
  }

  /**
   * Returns current CircuitBreakerState ("CLOSED" | "OPEN" | "HALF_OPEN").
   */
  public async getState(keyId?: string): Promise<CircuitBreakerState> {
    const data = await this.getData(keyId);
    return data.state;
  }

  /**
   * Synchronous state check from in-memory cache.
   */
  public getStateSync(keyId?: string): CircuitBreakerState {
    const data = this.getDataSync(keyId);
    return data?.state ?? "CLOSED";
  }

  /**
   * Contract method: canExecute()
   * Determines if a request execution is permitted.
   * - CLOSED: true
   * - OPEN: false (unless cooldown expired, which auto-transitions to HALF_OPEN -> returns true)
   * - HALF_OPEN: true (probe allowed)
   */
  public async canExecute(keyId?: string): Promise<boolean> {
    const state = await this.getState(keyId);
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  /**
   * Synchronous check if execution is permitted from memory.
   */
  public canExecuteSync(keyId?: string): boolean {
    const state = this.getStateSync(keyId);
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  /**
   * Contract method: trip()
   * Immediately trips the circuit breaker to OPEN state.
   */
  public async trip(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const currentTime = this.now();

    data.state = "OPEN";
    data.openedAt = currentTime;
    data.lastFailureTime = currentTime;
    data.consecutiveFailures = Math.max(data.consecutiveFailures, this.failureThreshold);
    data.consecutiveSuccesses = 0;

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Contract method: reset()
   * Immediately resets the circuit breaker to CLOSED state and clears failure counters.
   */
  public async reset(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = createDefaultCircuitBreakerData();

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Records a successful operation.
   * - In CLOSED: resets consecutiveFailures to 0.
   * - In HALF_OPEN: increments consecutiveSuccesses. If >= halfOpenSuccessThreshold, transitions to CLOSED.
   * - In OPEN: forces recovery to CLOSED if invoked.
   */
  public async recordSuccess(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const currentTime = this.now();

    data.lastSuccessTime = currentTime;

    if (data.state === "HALF_OPEN") {
      data.consecutiveSuccesses += 1;
      if (data.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        data.state = "CLOSED";
        data.consecutiveFailures = 0;
        data.consecutiveSuccesses = 0;
        data.openedAt = null;
      }
    } else if (data.state === "CLOSED") {
      data.consecutiveFailures = 0;
    } else if (data.state === "OPEN") {
      // Cooldown may have just expired or external probe succeeded
      data.state = "CLOSED";
      data.consecutiveFailures = 0;
      data.consecutiveSuccesses = 0;
      data.openedAt = null;
    }

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Records a failed operation.
   * - In CLOSED: increments consecutiveFailures. If >= failureThreshold, trips to OPEN.
   * - In HALF_OPEN: probe failed, trips back to OPEN and resets cooldown timer.
   * - In OPEN: refreshes lastFailureTime.
   */
  public async recordFailure(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const currentTime = this.now();

    data.lastFailureTime = currentTime;

    if (data.state === "CLOSED") {
      data.consecutiveFailures += 1;
      if (data.consecutiveFailures >= this.failureThreshold) {
        data.state = "OPEN";
        data.openedAt = currentTime;
        data.consecutiveSuccesses = 0;
      }
    } else if (data.state === "HALF_OPEN") {
      data.state = "OPEN";
      data.openedAt = currentTime;
      data.consecutiveSuccesses = 0;
      data.consecutiveFailures += 1;
    } else if (data.state === "OPEN") {
      data.consecutiveFailures += 1;
    }

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Informs CircuitBreaker of operation result (LLD 3.4).
   * Overloaded to accept (success: boolean) or (keyId: string, success: boolean).
   */
  public async recordResult(success: boolean): Promise<void>;
  public async recordResult(keyId: string, success: boolean): Promise<void>;
  public async recordResult(arg1: string | boolean, arg2?: boolean): Promise<void> {
    let id: string;
    let success: boolean;

    if (typeof arg1 === "boolean") {
      id = this.defaultKeyId;
      success = arg1;
    } else {
      id = arg1;
      success = arg2 ?? false;
    }

    if (success) {
      await this.recordSuccess(id);
    } else {
      await this.recordFailure(id);
    }
  }

  /**
   * Evaluates HTTP status code and updates circuit state accordingly.
   */
  public async recordStatusCode(statusCode: number): Promise<void>;
  public async recordStatusCode(keyId: string, statusCode: number): Promise<void>;
  public async recordStatusCode(arg1: string | number, arg2?: number): Promise<void> {
    let id: string;
    let statusCode: number;

    if (typeof arg1 === "number") {
      id = this.defaultKeyId;
      statusCode = arg1;
    } else {
      id = arg1;
      statusCode = arg2 ?? 500;
    }

    if (this.trippingStatusCodes.includes(statusCode)) {
      await this.recordFailure(id);
    } else if (statusCode >= 200 && statusCode < 300) {
      await this.recordSuccess(id);
    }
  }

  /**
   * Returns ISO-8601 timestamp string until which the circuit breaker is open.
   * Returns null if breaker is CLOSED or HALF_OPEN.
   */
  public async getCircuitOpenUntil(keyId?: string): Promise<string | null> {
    const data = await this.getData(keyId);
    if (data.state === "OPEN" && data.openedAt !== null) {
      return new Date(data.openedAt + this.cooldownMs).toISOString();
    }
    return null;
  }

  /**
   * Returns seconds remaining in cooldown window.
   * Returns 0 if breaker is not OPEN.
   */
  public async getRetryAfterSeconds(keyId?: string): Promise<number> {
    const data = await this.getData(keyId);
    if (data.state === "OPEN" && data.openedAt !== null) {
      const remainingMs = data.openedAt + this.cooldownMs - this.now();
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    }
    return 0;
  }

  /**
   * Asserts execution is allowed; throws CircuitBreakerTrippedError if OPEN.
   */
  public async throwIfOpen(keyId?: string, provider?: string): Promise<void> {
    const allowed = await this.canExecute(keyId);
    if (!allowed) {
      const id = this.resolveKeyId(keyId);
      const data = await this.getData(id);
      const retryAfter = await this.getRetryAfterSeconds(id);
      const openUntil = await this.getCircuitOpenUntil(id);

      throw new CircuitBreakerTrippedError(provider ?? id, undefined, {
        consecutiveFailures: data.consecutiveFailures,
        circuitOpenUntil: openUntil ?? undefined,
        retryAfterSeconds: retryAfter,
      });
    }
  }

  /**
   * Clears in-memory cache (simulates DO instance eviction).
   */
  public clearMemoryCache(): void {
    this.memory.clear();
  }
}
