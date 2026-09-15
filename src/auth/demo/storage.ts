/**
 * Key Collective v3 — Ephemeral Demo Tier DO Storage Manager
 *
 * Manages transactional persistence of ephemeral demo tokens and alarm scheduling
 * conforming to DO transactional storage invariants.
 */

import { STORAGE_KEY_EXPIRY, STORAGE_KEY_TOKEN } from "./constants";
import type { DemoDOStorageLike } from "./types";

export interface StoredDemoTokenData {
  token?: string;
  expiresAt?: number;
}

export class DemoStorage {
  constructor(private readonly storage: DemoDOStorageLike) {}

  /**
   * Loads saved demo token and expiry timestamp from transactional DO storage.
   */
  public async loadTokenData(): Promise<StoredDemoTokenData> {
    const token = await this.storage.get<string>(STORAGE_KEY_TOKEN);
    const expiresAt = await this.storage.get<number>(STORAGE_KEY_EXPIRY);
    return { token, expiresAt };
  }

  /**
   * Persists new or rotated demo token and its expiry timestamp.
   */
  public async persistTokenData(token: string, expiresAt: number): Promise<void> {
    await this.storage.put(STORAGE_KEY_TOKEN, token);
    await this.storage.put(STORAGE_KEY_EXPIRY, expiresAt);
  }

  /**
   * Schedules next rotation alarm matching token expiration.
   */
  public async scheduleAlarm(scheduledTime: number | Date): Promise<void> {
    await this.storage.setAlarm(scheduledTime);
  }

  /**
   * Retrieves active alarm timestamp if supported.
   */
  public async getAlarm(): Promise<number | null | undefined> {
    if (this.storage.getAlarm) {
      return await this.storage.getAlarm();
    }
    return undefined;
  }

  /**
   * Deletes scheduled alarm if supported.
   */
  public async deleteAlarm(): Promise<void> {
    if (this.storage.deleteAlarm) {
      await this.storage.deleteAlarm();
    }
  }
}
