import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Health Integration", () => {
  it("returns 200 on /v1/health", async () => {
    const res = await SELF.fetch("https://api.test/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
    expect(body).toEqual({ status: "ok" });
  });
});
