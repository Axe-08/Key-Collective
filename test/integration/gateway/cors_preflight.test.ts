/**
 * @file cors_preflight.test.ts
 * T-F.8.1 (QA-07): the browser Playground on console.* calls api.* cross-origin.
 * The preflight must allow the headers it sends, and the response must expose
 * the x-kc-* headers it reads.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { MainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";

const EXPOSED = [
  "x-kc-cu",
  "x-kc-model-used",
  "x-kc-provider",
  "x-kc-request-id",
  "x-kc-attempts",
  "x-kc-commons-notice",
];

function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

describe("T-F.8.1 api.* CORS for the browser Playground", () => {
  const worker = new MainWorker();
  const workerEnv = env as unknown as WorkerEnv;

  it("allows a preflight carrying the Playground headers", async () => {
    const res = await worker.fetch(
      new Request("https://api.test/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          origin: "https://console.test",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type, x-pool-fallback",
        },
      }),
      workerEnv
    );
    expect(res.status).toBe(204);
    const allowed = list(res.headers.get("access-control-allow-headers"));
    for (const h of ["authorization", "content-type", "x-pool-fallback"]) {
      expect(allowed).toContain(h);
    }
    expect(allowed).not.toContain("x-tenant-id");
    expect(list(res.headers.get("access-control-allow-methods"))).toContain("post");
  });

  it("exposes the x-kc-* response headers on preflight and on API responses", async () => {
    const pre = await worker.fetch(
      new Request("https://api.test/v1/chat/completions", { method: "OPTIONS" }),
      workerEnv
    );
    const res = await worker.fetch(
      new Request("https://api.test/v1/health", { method: "GET" }),
      workerEnv
    );
    for (const r of [pre, res]) {
      const exposed = list(r.headers.get("access-control-expose-headers"));
      for (const h of EXPOSED) {
        expect(exposed).toContain(h);
      }
    }
  });
});
