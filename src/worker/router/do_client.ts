/**
 * Key Collective v2/v4 — Durable Object Key Pool RPC Client Adapter
 * Conforms to:
 * - Per-Tenant DO Isolation (GEMINI.md Invariant):
 *   Dispatches requests to tenant-isolated Durable Objects via env.KEY_POOL.idFromName(tenantId).
 *   Enforces zero cross-tenant state leakage and verifies tenant boundary headers.
 */

import type { KeyPoolContract, KeyMetrics } from "../../contracts/key_pool";
import type { CapacitySummary } from "../../durable_objects/key_selector";
import { TenantIsolationError } from "../../errors/auth_errors";
import {
  InvalidKeyError,
  KeyNotFoundError,
  RateLimitExceededError,
} from "../../errors/key_errors";
import type { DurableObjectStubLike } from "./types";
import { RouterError } from "./errors";

/**
 * Adapter that presents a Cloudflare DurableObjectStub as a KeyPoolContract.
 * Enforces per-tenant DO isolation by communicating strictly with the designated tenant stub.
 */
export class DurableObjectKeyPoolClient implements KeyPoolContract {
  public readonly tenantId: string;
  private readonly stub: DurableObjectStubLike;
  private rpcDisabled = false;

  constructor(stub: DurableObjectStubLike, tenantId: string) {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new TenantIsolationError("DurableObjectKeyPoolClient requires a non-empty tenantId");
    }
    this.stub = stub;
    this.tenantId = tenantId;
  }

  private isRpcError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("does not support RPC") ||
      msg.includes("does not implement the method") ||
      msg.includes("RPC receiver") ||
      msg.includes("internal error")
    );
  }

  /**
   * Returns the underlying Durable Object stub.
   */
  public getStub(): DurableObjectStubLike {
    return this.stub;
  }

  /**
   * Acquires an active API key identifier for an upstream provider from the tenant's DO.
   */
  public async getKey(provider: string): Promise<string> {
    if (!provider || provider.trim().length === 0) {
      throw new InvalidKeyError("Provider parameter is required to acquire key");
    }

    // Direct DO RPC method invocation if supported
    if (!this.rpcDisabled && typeof this.stub.getKey === "function") {
      try {
        return await this.stub.getKey(provider);
      } catch (err: unknown) {
        if (this.isRpcError(err)) {
          this.rpcDisabled = true;
        } else {
          throw err;
        }
      }
    }

    // HTTP fetch RPC fallback
    const res = await this.stub.fetch("http://key-pool/keys/get", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({ provider, tenantId: this.tenantId }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new RateLimitExceededError(
          `Tenant '${this.tenantId}' key pool rate limit exceeded for provider '${provider}': ${errText}`,
          { tenantId: this.tenantId, provider }
        );
      }
      if (res.status === 403) {
        throw new TenantIsolationError(
          `Tenant isolation violation from DO: ${errText}`,
          { tenantId: this.tenantId }
        );
      }
      throw new KeyNotFoundError(
        provider,
        `No available key for provider '${provider}' in tenant '${this.tenantId}' pool: ${errText}`,
        { tenantId: this.tenantId }
      );
    }

    const data = (await res.json()) as {
      keyId?: string;
      key?: { id?: string; ciphertext?: string };
    };
    const resolvedKey = data.keyId ?? data.key?.id ?? data.key?.ciphertext;

    if (!resolvedKey) {
      throw new KeyNotFoundError(
        provider,
        `Tenant '${this.tenantId}' DO returned empty key for provider '${provider}'`,
        { tenantId: this.tenantId }
      );
    }

    return resolvedKey;
  }

  /**
   * Records token usage and microdollar cost against the key in the tenant's DO.
   */
  public async recordUsage(keyId: string, costMicrodollars: bigint): Promise<void> {
    if (!this.rpcDisabled && typeof this.stub.recordUsage === "function") {
      try {
        return await this.stub.recordUsage(keyId, costMicrodollars);
      } catch (err: unknown) {
        if (this.isRpcError(err)) {
          this.rpcDisabled = true;
        } else {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/usage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        costMicrodollars: costMicrodollars.toString(),
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Informs the tenant DO circuit breaker of upstream success or failure.
   */
  public async recordResult(keyId: string, success: boolean): Promise<void> {
    if (!this.rpcDisabled && typeof this.stub.recordResult === "function") {
      try {
        return await this.stub.recordResult(keyId, success);
      } catch (err: unknown) {
        if (this.isRpcError(err)) {
          this.rpcDisabled = true;
        } else {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        success,
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Records upstream HTTP status code against the key in the tenant's DO.
   */
  public async recordStatusCode(keyId: string, statusCode: number): Promise<void> {
    if (!this.rpcDisabled && typeof this.stub.recordStatusCode === "function") {
      try {
        return await this.stub.recordStatusCode(keyId, statusCode);
      } catch (err: unknown) {
        if (this.isRpcError(err)) {
          this.rpcDisabled = true;
        } else {
          throw err;
        }
      }
    }

    await this.stub.fetch("http://key-pool/keys/status-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": this.tenantId,
      },
      body: JSON.stringify({
        keyId,
        statusCode,
        tenantId: this.tenantId,
      }),
    });
  }

  /**
   * Queries real-time key metrics from the tenant's DO.
   */
  public async getKeyMetrics(keyId: string): Promise<KeyMetrics> {
    if (!this.rpcDisabled && typeof this.stub.getKeyMetrics === "function") {
      try {
        return await this.stub.getKeyMetrics(keyId);
      } catch (err: unknown) {
        if (this.isRpcError(err)) {
          this.rpcDisabled = true;
        } else {
          throw err;
        }
      }
    }

    const res = await this.stub.fetch(`http://key-pool/metrics?keyId=${encodeURIComponent(keyId)}`, {
      method: "GET",
      headers: {
        "x-tenant-id": this.tenantId,
      },
    });

    if (!res.ok) {
      throw new KeyNotFoundError(keyId, `Failed to retrieve metrics for key '${keyId}' from DO`);
    }

    const data = (await res.json()) as {
      metrics: {
        rpm: number;
        circuitBreakerTripped: boolean;
        costAccumulatedMicrodollars: string;
      };
    };

    return {
      rpm: data.metrics.rpm,
      circuitBreakerTripped: data.metrics.circuitBreakerTripped,
      costAccumulatedMicrodollars: BigInt(data.metrics.costAccumulatedMicrodollars ?? "0"),
    };
  }

  /**
   * Queries real-time capacity summary for a provider from the tenant's DO.
   */
  public async getCapacitySummary(provider?: string): Promise<CapacitySummary> {
    if (typeof this.stub.getCapacitySummary === "function") {
      return this.stub.getCapacitySummary(provider);
    }

    const url = provider
      ? `http://key-pool/capacity?provider=${encodeURIComponent(provider)}`
      : "http://key-pool/capacity";

    const res = await this.stub.fetch(url, {
      method: "GET",
      headers: {
        "x-tenant-id": this.tenantId,
      },
    });

    if (!res.ok) {
      throw new RouterError("Failed to retrieve capacity summary from DO", {
        statusCode: res.status,
      });
    }

    const data = (await res.json()) as { capacity: CapacitySummary };
    return data.capacity;
  }
}
