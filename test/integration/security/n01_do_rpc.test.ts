/**
 * Key Collective v4 — N-01 Security Regression: Raw DO RPC Exposure
 *
 * Finding N-01: `/v1/keys`, `/v1/keys/usage`, `/v1/metrics`, `/v1/capacity` were
 * previously forwarded verbatim (method + body intact) into the tenant's
 * KeyPoolDO HTTP RPC surface (durable_objects/key_pool/rpc.ts) by
 * `dispatcher.ts`'s `forwardToDO`. That raw DO RPC forwarding has been removed.
 *
 * Invariants Tested:
 * 1. Every HTTP method on /v1/keys, /v1/keys/usage, /v1/metrics, /v1/capacity
 *    returns HTTP 404 (ROUTE_NOT_FOUND / Not Found), on every gateway host
 *    (api.*, console.*, admin.*, and the apex domain).
 * 2. No request ever reaches the tenant's KeyPoolDO stub for these paths —
 *    the DO's HTTP RPC surface is never invoked as a side effect of routing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createWorker, MainWorker } from "../../../src/worker/index";
import {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../../../src/worker/auth/index";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../../../src/worker/router/index";

/**
 * Mock DurableObjectStub that records every fetch() call it receives,
 * so we can assert the KeyPoolDO HTTP RPC surface was never reached.
 */
class MockDurableObjectStub implements DurableObjectStubLike {
  public tenantId: string;
  public fetchCalls: { url: string; method: string }[] = [];

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlStr = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    this.fetchCalls.push({ url: urlStr, method });
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Mock DurableObjectNamespace creating MockDurableObjectStubs per tenant.
 */
class MockDurableObjectNamespace implements DurableObjectNamespaceLike {
  public stubs = new Map<string, MockDurableObjectStub>();

  idFromName(name: string): DurableObjectId {
    return {
      toString: () => name,
      name,
    } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStubLike {
    const name = (id as unknown as { name?: string }).name ?? id.toString();
    let stub = this.stubs.get(name);
    if (!stub) {
      stub = new MockDurableObjectStub(name);
      this.stubs.set(name, stub);
    }
    return stub;
  }
}

const PROTECTED_PATHS = [
  "/v1/keys",
  "/v1/keys/usage",
  "/v1/metrics",
  "/v1/capacity",
];

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const HOSTS = [
  "api.keycollective.ai",
  "console.keycollective.ai",
  "admin.keycollective.ai",
  "keycollective.ai", // apex
];

describe("N-01 Security Regression: Raw DO RPC forwarding removed", () => {
  let doNamespace: MockDurableObjectNamespace;
  let env: WorkerEnv;
  let defaultAuthContext: AuthenticatedContext;
  let authenticatedWorker: MainWorker;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    env = {
      KEY_POOL: doNamespace as unknown as DurableObjectNamespace,
    };

    defaultAuthContext = {
      tenantId: "tenant-alpha",
      isAuthenticated: true,
      token: {
        id: "token-uuid-1",
        hashSha256: "hash123",
        tenantId: "tenant-alpha",
        budgetMicrodollars: 10_000_000n,
        spentMicrodollars: 0n,
        allowedProviders: [],
        rpmLimit: 60,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetMicrodollars: 10_000_000n,
      spentMicrodollars: 0n,
      budgetRemainingMicrodollars: 10_000_000n,
    };

    // Auth middleware stubbed to always succeed, so that route resolution
    // (not auth failure) is what determines the response for these paths.
    const authMiddleware = new AuthMiddleware();
    authMiddleware.authenticate = async () => defaultAuthContext;

    authenticatedWorker = new MainWorker({ authMiddleware });
  });

  for (const host of HOSTS) {
    describe(`host: ${host}`, () => {
      for (const path of PROTECTED_PATHS) {
        for (const method of METHODS) {
          it(`${method} ${path} returns 404 and never reaches KeyPoolDO`, async () => {
            const req = new Request(`https://${host}${path}`, {
              method,
              headers: {
                authorization: "Bearer kc_test_token_n01",
                "content-type": "application/json",
              },
              body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({}),
            });

            const res = await authenticatedWorker.fetch(req, env);

            // admin.* denies unauthenticated/unverified admin requests with a
            // zero-knowledge 404 before ever reaching route dispatch; every
            // other host must resolve through the router as ROUTE_NOT_FOUND.
            expect(res.status).toBe(404);

            for (const stub of doNamespace.stubs.values()) {
              expect(stub.fetchCalls).toHaveLength(0);
            }
          });
        }
      }
    });
  }

  it("standalone createWorker() also never forwards /v1/keys, /v1/metrics, /v1/capacity to the DO", async () => {
    const authMiddleware = new AuthMiddleware();
    authMiddleware.authenticate = async () => defaultAuthContext;
    const worker = createWorker({ authMiddleware });

    for (const path of PROTECTED_PATHS) {
      const req = new Request(`https://api.keycollective.ai${path}`, {
        method: "GET",
        headers: { authorization: "Bearer kc_test_token_n01" },
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
    }

    for (const stub of doNamespace.stubs.values()) {
      expect(stub.fetchCalls).toHaveLength(0);
    }
  });
});
