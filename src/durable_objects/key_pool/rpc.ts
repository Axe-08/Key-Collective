/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPoolDO HTTP RPC Request Dispatcher
 */

import { EncryptedKey } from "../../contracts/key_pool";
import { DomainError } from "../../errors/domain_error";
import { InvalidKeyError } from "../../errors/key_errors";
import { isEncryptedKey } from "./types";

export interface KeyPoolRpcHandlerContext {
  tenantId: string;
  assertTenant: (targetTenantId?: string) => void;
  ensureLoaded: () => Promise<void>;
  getKey: (provider: string) => Promise<string>;
  getKeyById: (keyId: string) => Promise<EncryptedKey | undefined>;
  recordUsage: (keyId: string, cost: bigint) => Promise<void>;
  recordResult: (keyId: string, success: boolean) => Promise<void>;
  recordStatusCode: (keyId: string, statusCode: number) => Promise<void>;
  getKeys: (provider?: string) => Promise<EncryptedKey[]>;
  addKey: (key: EncryptedKey) => Promise<void>;
  addKeys: (keys: EncryptedKey[]) => Promise<void>;
  setKeys: (keys: EncryptedKey[]) => Promise<void>;
  removeKey: (keyId: string) => Promise<boolean>;
  getKeyMetrics: (keyId: string) => Promise<any>;
  getCapacitySummary: (provider?: string) => Promise<any>;
  now: () => number;
  keysCount: () => number;
}

/**
 * Handles incoming HTTP requests to KeyPoolDO.
 */
export async function handleKeyPoolRpc(
  request: Request,
  ctx: KeyPoolRpcHandlerContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Tenant isolation validation via header
    const headerTenant = request.headers.get("x-tenant-id");
    if (headerTenant) {
      ctx.assertTenant(headerTenant);
    }

    // 1. Health check
    if (url.pathname === "/health") {
      await ctx.ensureLoaded();
      return Response.json({
        status: "healthy",
        do: true,
        tenantId: ctx.tenantId,
        keyCount: ctx.keysCount(),
        timestamp: new Date(ctx.now()).toISOString(),
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
          ctx.assertTenant(body.tenantId as string);
        }
        if (typeof body.provider === "string") {
          provider = body.provider;
        }
      }

      if (!provider) {
        throw new InvalidKeyError("Provider parameter is required");
      }

      const keyId = await ctx.getKey(provider);
      const keyDetails = await ctx.getKeyById(keyId);

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
        ctx.assertTenant(body.tenantId as string);
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

      await ctx.recordUsage(keyId, cost);
      return Response.json({ success: true, keyId, cost: cost.toString() });
    }

    // 4. Record result: POST /keys/result
    if (method === "POST" && url.pathname === "/keys/result") {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (body.tenantId) {
        ctx.assertTenant(body.tenantId as string);
      }

      const keyId = body.keyId as string;
      const success = Boolean(body.success);

      await ctx.recordResult(keyId, success);
      return Response.json({ success: true, keyId, recordedSuccess: success });
    }

    // 5. Record status code: POST /keys/status-code
    if (method === "POST" && url.pathname === "/keys/status-code") {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (body.tenantId) {
        ctx.assertTenant(body.tenantId as string);
      }

      const keyId = body.keyId as string;
      const statusCode = Number(body.statusCode ?? 500);

      await ctx.recordStatusCode(keyId, statusCode);
      return Response.json({ success: true, keyId, statusCode });
    }

    // 6. List keys: GET /keys
    if (method === "GET" && url.pathname === "/keys") {
      const provider = url.searchParams.get("provider") ?? undefined;
      const keys = await ctx.getKeys(provider);
      return Response.json({ keys, count: keys.length });
    }

    // 7. Add or update key: POST /keys
    if (method === "POST" && url.pathname === "/keys") {
      const body = (await request.json()) as Record<string, unknown>;
      if (Array.isArray(body.keys)) {
        await ctx.addKeys(body.keys as EncryptedKey[]);
        return Response.json({ success: true, addedCount: body.keys.length });
      } else if (body.key) {
        await ctx.addKey(body.key as EncryptedKey);
        return Response.json({ success: true });
      } else if (isEncryptedKey(body)) {
        await ctx.addKey(body);
        return Response.json({ success: true });
      }
      throw new InvalidKeyError("Invalid key payload");
    }

    // 8. Replace keys: PUT /keys
    if (method === "PUT" && url.pathname === "/keys") {
      const body = (await request.json()) as { keys?: EncryptedKey[] };
      if (Array.isArray(body.keys)) {
        await ctx.setKeys(body.keys);
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
      const removed = await ctx.removeKey(keyId);
      return Response.json({ success: true, removed, keyId });
    }

    // 10. Metrics: GET /metrics
    if (method === "GET" && url.pathname === "/metrics") {
      const keyId = url.searchParams.get("keyId");
      if (!keyId) {
        throw new InvalidKeyError("Key ID is required for /metrics");
      }
      const metrics = await ctx.getKeyMetrics(keyId);
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
      const capacity = await ctx.getCapacitySummary(provider);
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
