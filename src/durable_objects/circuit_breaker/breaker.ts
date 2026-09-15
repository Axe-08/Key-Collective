/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Circuit Breaker Subsystem: Main CircuitBreaker Class
 *
 * Conforms to LLD 3.1:
 * - State Machine: CLOSED -> OPEN -> HALF_OPEN.
 * - Storage: Persists state to DO transactional storage.
 * - Contract: trip(), reset(), canExecute().
 * - Result recording: recordResult(), recordSuccess(), recordFailure(), recordStatusCode().
 *
 * Invariants (GEMINI.md):
 * - Strict TypeScript (no `any`).
 * - DO Transactional Storage for Hot State.
 * - Zero floating-point math.
 */

import {
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES,
} from "../../constants/limits";
import { CircuitBreakerTrippedError } from "../../errors/routing_errors";
import type { CircuitBreakerConfig } from "../../types/config";
import type {
  CircuitBreakerData,
  CircuitBreakerOptions,
  CircuitBreakerState,
  DurableObjectStorageLike,
} from "./types";
import {
  applyFailure,
  applyReset,
  applySuccess,
  applyTrip,
  evaluateCooldown,
} from "./state_machine";
import { CircuitBreakerStorage } from "./storage";

export class CircuitBreaker {
  private readonly store: CircuitBreakerStorage;
  private readonly defaultKeyId: string;
  public readonly failureThreshold: number;
  public readonly cooldownSeconds: number;
  public readonly cooldownMs: number;
  public readonly halfOpenSuccessThreshold: number;
  public readonly trippingStatusCodes: readonly number[];
  private readonly timeProvider: () => number;

  constructor(
    storage: DurableObjectStorageLike,
    options?: CircuitBreakerOptions | Partial<CircuitBreakerConfig>
  ) {
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
    const prefix = opts?.storageKeyPrefix ?? "cb:";
    this.timeProvider = opts?.timeProvider ?? (() => Date.now());
    this.store = new CircuitBreakerStorage(storage, prefix);
  }

  private now(): number {
    return this.timeProvider();
  }

  public getStorageKey(keyId?: string): string {
    const id = keyId ?? this.defaultKeyId;
    return this.store.getStorageKey(id);
  }

  private resolveKeyId(keyId?: string): string {
    return keyId ?? this.defaultKeyId;
  }

  public async getData(keyId?: string): Promise<CircuitBreakerData> {
    const id = this.resolveKeyId(keyId);
    const data = await this.store.load(id);

    if (evaluateCooldown(data, this.now(), this.cooldownMs)) {
      await this.store.persist(id, data);
    }

    return { ...data };
  }

  public getDataSync(keyId?: string): CircuitBreakerData | undefined {
    const id = this.resolveKeyId(keyId);
    const data = this.store.getSync(id);
    if (data) {
      evaluateCooldown(data, this.now(), this.cooldownMs);
      return { ...data };
    }
    return undefined;
  }

  public async getState(keyId?: string): Promise<CircuitBreakerState> {
    const data = await this.getData(keyId);
    return data.state;
  }

  public getStateSync(keyId?: string): CircuitBreakerState {
    const data = this.getDataSync(keyId);
    return data?.state ?? "CLOSED";
  }

  public async canExecute(keyId?: string): Promise<boolean> {
    const state = await this.getState(keyId);
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  public canExecuteSync(keyId?: string): boolean {
    const state = this.getStateSync(keyId);
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  public async trip(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    applyTrip(data, this.now(), this.failureThreshold);
    this.store.setMemory(id, data);
    await this.store.persist(id, data);
  }

  public async reset(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    applyReset(data);
    this.store.setMemory(id, data);
    await this.store.persist(id, data);
  }

  public async recordSuccess(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    applySuccess(data, this.now(), this.halfOpenSuccessThreshold);
    this.store.setMemory(id, data);
    await this.store.persist(id, data);
  }

  public async recordFailure(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    applyFailure(data, this.now(), this.failureThreshold);
    this.store.setMemory(id, data);
    await this.store.persist(id, data);
  }

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

  public async getCircuitOpenUntil(keyId?: string): Promise<string | null> {
    const data = await this.getData(keyId);
    if (data.state === "OPEN" && data.openedAt !== null) {
      return new Date(data.openedAt + this.cooldownMs).toISOString();
    }
    return null;
  }

  public async getRetryAfterSeconds(keyId?: string): Promise<number> {
    const data = await this.getData(keyId);
    if (data.state === "OPEN" && data.openedAt !== null) {
      const remainingMs = data.openedAt + this.cooldownMs - this.now();
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    }
    return 0;
  }

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

  public clearMemoryCache(): void {
    this.store.clearMemory();
  }
}
