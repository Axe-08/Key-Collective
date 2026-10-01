import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("Key Collective Smoke Gate", () => {
  it("returns 200 and healthy payload on /health", async () => {
    const request = new Request("https://proxy.keycollective.internal/health");
    const mockEnv = {} as any;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };
    expect(["ok", "healthy"]).toContain(body.status);
  });

  it("returns ready message on root endpoint", async () => {
    const request = new Request("https://proxy.keycollective.internal/");
    const mockEnv = {} as any;
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Key Collective v2 Edge Proxy Ready");
  });
});
