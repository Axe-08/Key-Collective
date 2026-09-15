/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Circuit Breaker Subsystem: Transactional Storage Manager
 *
 * Invariants (GEMINI.md Constitution):
 * - DO Transactional Storage for Hot State: In-memory circuit breaker syncs to this.ctx.storage.
 * - Survives DO eviction.
 */

import type { CircuitBreakerData, DurableObjectStorageLike } from "./types";
import { createDefaultCircuitBreakerData, isCircuitBreakerData } from "./types";

export class CircuitBreakerStorage {
  private readonly memory = new Map<string, CircuitBreakerData>();

  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly storageKeyPrefix: string
  ) {}

  public getStorageKey(keyId: string): string {
    return `${this.storageKeyPrefix}${keyId}`;
  }

  public async load(keyId: string): Promise<CircuitBreakerData> {
    let data = this.memory.get(keyId);
    if (!data) {
      const storageKey = this.getStorageKey(keyId);
      const stored = await this.storage.get<CircuitBreakerData>(storageKey);

      if (stored && isCircuitBreakerData(stored)) {
        data = { ...stored };
      } else {
        data = createDefaultCircuitBreakerData();
      }
      this.memory.set(keyId, data);
    }
    return data;
  }

  public getSync(keyId: string): CircuitBreakerData | undefined {
    return this.memory.get(keyId);
  }

  public setMemory(keyId: string, data: CircuitBreakerData): void {
    this.memory.set(keyId, data);
  }

  public async persist(keyId: string, data: CircuitBreakerData): Promise<void> {
    const storageKey = this.getStorageKey(keyId);
    await this.storage.put<CircuitBreakerData>(storageKey, { ...data });
  }

  public clearMemory(): void {
    this.memory.clear();
  }
}
