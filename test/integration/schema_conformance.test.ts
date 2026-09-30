import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Schema Conformance Skeleton", () => {
  it("connects to migrated D1 test database", async () => {
    const row = await env.DB.prepare("SELECT 1 as alive").first<{ alive: number }>();
    expect(row?.alive).toBe(1);
  });
});
