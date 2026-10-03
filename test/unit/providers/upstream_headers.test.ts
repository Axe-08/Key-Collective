/**
 * T-F.1.2 (RA-02): internal routing headers never reach a provider.
 */
import { describe, expect, it } from "vitest";
import { rewriteHeaders } from "../../../src/proxy/upstream/headers";

describe("rewriteHeaders strips internal headers (T-F.1.2)", () => {
  it("drops every x-kc-* header and x-tenant-id, keeps unrelated headers", () => {
    const incoming: Record<string, string> = {
      "x-kc-trace-id": "trace-1",
      "x-kc-tenant-id": "usr_goog_secret",
      "X-KC-Key-Id": "key_abc",
      "x-kc-anything-new": "1",
      "x-tenant-id": "usr_goog_secret",
      "x-request-id": "req-keep",
    };
    for (const provider of ["google", "groq"]) {
      const out = rewriteHeaders(provider, incoming, "provider-key");
      const names = Array.from(out.keys());
      expect(names.filter((n) => n.startsWith("x-kc-"))).toEqual([]);
      expect(out.has("x-tenant-id")).toBe(false);
      expect(out.get("x-request-id")).toBe("req-keep");
    }
  });

  it("strips them from a Headers instance too", () => {
    const incoming = new Headers({ "X-Kc-Tenant-Id": "t", "X-Tenant-Id": "t" });
    const out = rewriteHeaders("google", incoming, "k");
    expect(out.has("x-kc-tenant-id")).toBe(false);
    expect(out.has("x-tenant-id")).toBe(false);
  });
});
