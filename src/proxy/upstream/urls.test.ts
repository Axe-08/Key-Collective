/**
 * Key Collective v2 — Upstream URL Resolution Tests
 *
 * Conforms to:
 * - LLD 3.4: Providers and model catalog. Only `google` and `groq` are supported
 *   providers; unknown providers must raise a configuration error rather than
 *   guessing a URL.
 */

import { describe, it, expect } from "vitest";
import { buildProviderUrl } from "./urls";

describe("buildProviderUrl", () => {
  it("resolves the google provider to its OpenAI-compatible base URL", () => {
    expect(buildProviderUrl("google")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
  });

  it("resolves the groq provider to its base URL", () => {
    expect(buildProviderUrl("groq")).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("throws a configuration error for an unknown provider instead of guessing a URL", () => {
    expect(() => buildProviderUrl("cerebras")).toThrow(/Unknown provider/);
  });
});
