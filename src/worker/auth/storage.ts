/**
 * @file storage.ts
 * In-memory implementation of DurableObjectStorageLike for edge rate limiting.
 */

import type { DurableObjectStorageLike } from "../../durable_objects/circuit_breaker";

/**
 * In-memory implementation of DurableObjectStorageLike.
 * Enables edge-worker sliding-window rate limiting in local worker memory
 * when persistent DO storage is not explicitly passed.
 */
export class InMemoryRateLimiterStorage implements DurableObjectStorageLike {
  private readonly store = new Map<string, unknown>();

  public async get<T = unknown>(key: string): Promise<T | undefined>;
  public async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  public async get<T = unknown>(
    keyOrKeys: string | string[]
  ): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>();
      for (const k of keyOrKeys) {
        if (this.store.has(k)) {
          result.set(k, this.store.get(k) as T);
        }
      }
      return result;
    }
    return this.store.get(keyOrKeys) as T | undefined;
  }

  public async put<T = unknown>(key: string, value: T): Promise<void>;
  public async put<T = unknown>(entries: Record<string, T>): Promise<void>;
  public async put<T = unknown>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.store.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.store.set(k, v);
      }
    }
  }

  public async delete(key: string): Promise<boolean>;
  public async delete(keys: string[]): Promise<number>;
  public async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const k of keyOrKeys) {
        if (this.store.delete(k)) count++;
      }
      return count;
    }
    return this.store.delete(keyOrKeys);
  }

  public async deleteAll(): Promise<void> {
    this.store.clear();
  }

  public async list<T = unknown>(options?: {
    prefix?: string;
  }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        result.set(k, v as T);
      }
    }
    return result;
  }
}
