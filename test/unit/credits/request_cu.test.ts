import { describe, it, expect } from "vitest";
import {
  CU,
  ceilDiv,
  formatCu,
} from "../../../src/constants/credits";
import {
  ALL_MODEL_DEFINITIONS,
  DEFAULT_MODEL_DEFINITIONS,
  FREE_TIER_MODEL_DEFINITIONS,
} from "../../../src/router/registry/catalog";
import {
  calculateCu,
  ModelRegistry,
} from "../../../src/router/registry/registry";
import type { ModelDef } from "../../../src/types/models";
import type { TokenUsage } from "../../../src/router/registry/types";

describe("Credit Units (CU) System & calculateCu", () => {
  describe("ceilDiv (Integer Ceiling Division)", () => {
    it("returns bigint results for small numbers", () => {
      const res = ceilDiv(0n, 1000n);
      expect(typeof res).toBe("bigint");
      expect(res).toBe(0n);
    });

    it("evaluates correctly for token boundaries around 1000n", () => {
      expect(ceilDiv(0n, 1000n)).toBe(0n);
      expect(ceilDiv(1n, 1000n)).toBe(1n);
      expect(ceilDiv(500n, 1000n)).toBe(1n);
      expect(ceilDiv(999n, 1000n)).toBe(1n);
      expect(ceilDiv(1000n, 1000n)).toBe(1n);
      expect(ceilDiv(1001n, 1000n)).toBe(2n);
      expect(ceilDiv(1999n, 1000n)).toBe(2n);
      expect(ceilDiv(2000n, 1000n)).toBe(2n);
      expect(ceilDiv(2001n, 1000n)).toBe(3n);
    });

    it("evaluates correctly for general divisors", () => {
      expect(ceilDiv(0n, 1n)).toBe(0n);
      expect(ceilDiv(10n, 1n)).toBe(10n);
      expect(ceilDiv(7n, 2n)).toBe(4n);
      expect(ceilDiv(8n, 2n)).toBe(4n);
      expect(ceilDiv(9n, 3n)).toBe(3n);
      expect(ceilDiv(10n, 3n)).toBe(4n);
    });

    it("evaluates correctly for large numbers without precision loss", () => {
      const largeNum = 1_000_000_000_000_001n;
      const divisor = 1_000_000_000n;
      expect(ceilDiv(largeNum, divisor)).toBe(1_000_001n);

      const huge = 10n ** 18n + 1n;
      expect(ceilDiv(huge, 1000n)).toBe(10n ** 15n + 1n);
    });
  });

  describe("formatCu", () => {
    it("formats Credit Units into locale-aware string representation", () => {
      expect(formatCu(0n)).toBe("0");
      expect(formatCu(10n)).toBe("10");
      expect(formatCu(1000n)).toBe("1,000");
      expect(formatCu(1_000_000n)).toBe("1,000,000");
      expect(formatCu(123_456_789n)).toBe("123,456,789");
    });
  });

  describe("Table-Driven Catalog Model Weight Verification", () => {
    it("contains all catalog models and validates their CU fields are bigints", () => {
      expect(ALL_MODEL_DEFINITIONS.length).toBeGreaterThanOrEqual(12);

      for (const model of ALL_MODEL_DEFINITIONS) {
        expect(typeof model.cuBase, `model ${model.id} cuBase`).toBe("bigint");
        expect(typeof model.cuInPer1k, `model ${model.id} cuInPer1k`).toBe("bigint");
        expect(typeof model.cuCachedPer1k, `model ${model.id} cuCachedPer1k`).toBe("bigint");
        expect(typeof model.cuOutPer1k, `model ${model.id} cuOutPer1k`).toBe("bigint");

        expect(model.cuBase >= 0n).toBe(true);
        expect(model.cuInPer1k >= 0n).toBe(true);
        expect(model.cuCachedPer1k >= 0n).toBe(true);
        expect(model.cuOutPer1k >= 0n).toBe(true);
      }
    });

    it.each(ALL_MODEL_DEFINITIONS.map((m) => [m.id, m]))(
      "model %s has expected starting CU weights according to section 2.2",
      (_id, model) => {
        if (model.id.includes("flash-lite")) {
          expect(model.cuBase).toBe(5n);
          expect(model.cuInPer1k).toBe(1n);
          expect(model.cuCachedPer1k).toBe(0n);
          expect(model.cuOutPer1k).toBe(2n);
        } else if (model.id.includes("flash")) {
          expect(model.cuBase).toBe(10n);
          expect(model.cuInPer1k).toBe(1n);
          expect(model.cuCachedPer1k).toBe(0n);
          expect(model.cuOutPer1k).toBe(4n);
        } else if (model.id.includes("pro")) {
          expect(model.cuBase).toBe(50n);
          expect(model.cuInPer1k).toBe(5n);
          expect(model.cuCachedPer1k).toBe(1n);
          expect(model.cuOutPer1k).toBe(20n);
        } else if (model.id === "openai/gpt-oss-20b" || model.id.includes("8b-instant")) {
          expect(model.cuBase).toBe(5n);
          expect(model.cuInPer1k).toBe(1n);
          expect(model.cuCachedPer1k).toBe(0n);
          expect(model.cuOutPer1k).toBe(1n);
        } else if (
          model.id.includes("70b-versatile") ||
          model.id.includes("gpt-oss-120b") ||
          model.id.startsWith("qwen/")
        ) {
          expect(model.cuBase).toBe(10n);
          expect(model.cuInPer1k).toBe(2n);
          expect(model.cuCachedPer1k).toBe(0n);
          expect(model.cuOutPer1k).toBe(4n);
        }
      }
    );
  });

  describe("calculateCu Boundary Tests", () => {
    const flashModel: ModelDef = ALL_MODEL_DEFINITIONS.find(
      (m) => m.id === "gemini-2.0-flash"
    )!;
    const proModel: ModelDef = ALL_MODEL_DEFINITIONS.find(
      (m) => m.id === "gemini-1.5-pro"
    )!;

    it("returns cuBase for 0 tokens (all usage 0)", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const usage: TokenUsage = {
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
        };
        const result = calculateCu(model, usage);
        expect(typeof result).toBe("bigint");
        expect(result).toBe(model.cuBase);
      }
    });

    it("returns cuBase when optional usage fields are omitted", () => {
      const usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
      };
      const result = calculateCu(flashModel, usage);
      expect(result).toBe(flashModel.cuBase);
    });

    it("evaluates prompt token boundary at 999, 1000, 1001 tokens", () => {
      // flashModel: cuBase = 10n, cuInPer1k = 1n
      const at0 = calculateCu(flashModel, { promptTokens: 0, completionTokens: 0 });
      expect(at0).toBe(10n);

      const at999 = calculateCu(flashModel, { promptTokens: 999, completionTokens: 0 });
      // 10n + ceilDiv(999n * 1n, 1000n) = 10n + 1n = 11n
      expect(at999).toBe(11n);

      const at1000 = calculateCu(flashModel, { promptTokens: 1000, completionTokens: 0 });
      // 10n + ceilDiv(1000n * 1n, 1000n) = 10n + 1n = 11n
      expect(at1000).toBe(11n);
      expect(at999).toBe(at1000);

      const at1001 = calculateCu(flashModel, { promptTokens: 1001, completionTokens: 0 });
      // 10n + ceilDiv(1001n * 1n, 1000n) = 10n + 2n = 12n
      expect(at1001).toBe(12n);
      expect(at1001).toBeGreaterThan(at1000);
    });

    it("evaluates output token boundary (completion + reasoning) at 999, 1000, 1001 tokens", () => {
      // flashModel: cuBase = 10n, cuOutPer1k = 4n
      const at999 = calculateCu(flashModel, {
        promptTokens: 0,
        completionTokens: 999,
      });
      // 10n + ceilDiv(999n * 4n, 1000n) = 10n + 4n = 14n
      expect(at999).toBe(14n);

      const at1000 = calculateCu(flashModel, {
        promptTokens: 0,
        completionTokens: 1000,
      });
      // 10n + ceilDiv(1000n * 4n, 1000n) = 10n + 4n = 14n
      expect(at1000).toBe(14n);
      expect(at999).toBe(at1000);

      const at1001 = calculateCu(flashModel, {
        promptTokens: 0,
        completionTokens: 1001,
      });
      // 10n + ceilDiv(1001n * 4n, 1000n) = 10n + 5n = 15n
      expect(at1001).toBe(15n);
      expect(at1001).toBeGreaterThan(at1000);

      // Reasoning tokens are billed at the same rate as completion tokens
      const withReasoning1000 = calculateCu(flashModel, {
        promptTokens: 0,
        completionTokens: 400,
        reasoningTokens: 600,
      });
      expect(withReasoning1000).toBe(14n);

      const withReasoning1001 = calculateCu(flashModel, {
        promptTokens: 0,
        completionTokens: 400,
        reasoningTokens: 601,
      });
      expect(withReasoning1001).toBe(15n);
    });

    it("evaluates cached tokens boundary at 999, 1000, 1001 tokens", () => {
      // proModel: cuBase = 50n, cuCachedPer1k = 1n
      const at0 = calculateCu(proModel, { promptTokens: 0, completionTokens: 0, cachedTokens: 0 });
      expect(at0).toBe(50n);

      const at999 = calculateCu(proModel, { promptTokens: 0, completionTokens: 0, cachedTokens: 999 });
      // 50n + ceilDiv(999n * 1n, 1000n) = 50n + 1n = 51n
      expect(at999).toBe(51n);

      const at1000 = calculateCu(proModel, { promptTokens: 0, completionTokens: 0, cachedTokens: 1000 });
      // 50n + ceilDiv(1000n * 1n, 1000n) = 50n + 1n = 51n
      expect(at1000).toBe(51n);
      expect(at999).toBe(at1000);

      const at1001 = calculateCu(proModel, { promptTokens: 0, completionTokens: 0, cachedTokens: 1001 });
      // 50n + ceilDiv(1001n * 1n, 1000n) = 50n + 2n = 52n
      expect(at1001).toBe(52n);
      expect(at1001).toBeGreaterThan(at1000);
    });

    it("ensures every calculateCu result is a bigint", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const res = calculateCu(model, {
          promptTokens: 1234,
          completionTokens: 567,
          cachedTokens: 890,
          reasoningTokens: 100,
        });
        expect(typeof res).toBe("bigint");
      }
    });

    it("can be called through ModelRegistry instance", () => {
      const registry = new ModelRegistry(ALL_MODEL_DEFINITIONS);
      const cu = registry.calculateCu("gemini-2.0-flash", {
        promptTokens: 1000,
        completionTokens: 1000,
      });
      expect(typeof cu).toBe("bigint");
      // gemini-2.0-flash: cuBase=10, cuInPer1k=1, cuOutPer1k=4 -> 10 + 1 + 4 = 15n
      expect(cu).toBe(15n);
    });
  });

  describe("Property test: request_cu is monotonic in each token count", () => {
    it("is monotonic in prompt tokens across all catalog models", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const sampleCounts = [
          0, 1, 10, 500, 999, 1000, 1001, 1999, 2000, 2001, 5000, 10000, 100000,
        ];
        let prevCu = -1n;
        for (const promptTokens of sampleCounts) {
          const cu = calculateCu(model, {
            promptTokens,
            completionTokens: 200,
            cachedTokens: 100,
            reasoningTokens: 50,
          });
          expect(typeof cu).toBe("bigint");
          if (prevCu !== -1n) {
            expect(cu >= prevCu).toBe(true);
          }
          prevCu = cu;
        }
      }
    });

    it("is monotonic in completion tokens across all catalog models", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const sampleCounts = [
          0, 1, 10, 500, 999, 1000, 1001, 1999, 2000, 2001, 5000, 10000, 50000,
        ];
        let prevCu = -1n;
        for (const completionTokens of sampleCounts) {
          const cu = calculateCu(model, {
            promptTokens: 500,
            completionTokens,
            cachedTokens: 100,
            reasoningTokens: 0,
          });
          expect(typeof cu).toBe("bigint");
          if (prevCu !== -1n) {
            expect(cu >= prevCu).toBe(true);
          }
          prevCu = cu;
        }
      }
    });

    it("is monotonic in cached tokens across all catalog models", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const sampleCounts = [
          0, 1, 10, 500, 999, 1000, 1001, 1999, 2000, 2001, 5000, 10000, 50000,
        ];
        let prevCu = -1n;
        for (const cachedTokens of sampleCounts) {
          const cu = calculateCu(model, {
            promptTokens: 1000,
            completionTokens: 500,
            cachedTokens,
            reasoningTokens: 0,
          });
          expect(typeof cu).toBe("bigint");
          if (prevCu !== -1n) {
            expect(cu >= prevCu).toBe(true);
          }
          prevCu = cu;
        }
      }
    });

    it("is monotonic in reasoning tokens across all catalog models", () => {
      for (const model of ALL_MODEL_DEFINITIONS) {
        const sampleCounts = [
          0, 1, 10, 500, 999, 1000, 1001, 1999, 2000, 2001, 5000, 10000, 50000,
        ];
        let prevCu = -1n;
        for (const reasoningTokens of sampleCounts) {
          const cu = calculateCu(model, {
            promptTokens: 1000,
            completionTokens: 500,
            cachedTokens: 0,
            reasoningTokens,
          });
          expect(typeof cu).toBe("bigint");
          if (prevCu !== -1n) {
            expect(cu >= prevCu).toBe(true);
          }
          prevCu = cu;
        }
      }
    });

    it("randomized property check: monotonic under arbitrary non-decreasing token increments", () => {
      // Seeded-style pseudo-random sequence for deterministic reproducibility
      let seed = 42;
      function pseudoRandom(max: number): number {
        seed = (seed * 9301 + 49297) % 233280;
        return Math.floor((seed / 233280) * max);
      }

      for (const model of ALL_MODEL_DEFINITIONS) {
        for (let iter = 0; iter < 100; iter++) {
          const p1 = pseudoRandom(5000);
          const p2 = p1 + pseudoRandom(2000);
          const c1 = pseudoRandom(2000);
          const c2 = c1 + pseudoRandom(1000);
          const k1 = pseudoRandom(3000);
          const k2 = k1 + pseudoRandom(1000);
          const r1 = pseudoRandom(1000);
          const r2 = r1 + pseudoRandom(500);

          const cuLow = calculateCu(model, {
            promptTokens: p1,
            completionTokens: c1,
            cachedTokens: k1,
            reasoningTokens: r1,
          });

          const cuHigh = calculateCu(model, {
            promptTokens: p2,
            completionTokens: c2,
            cachedTokens: k2,
            reasoningTokens: r2,
          });

          expect(cuHigh >= cuLow).toBe(true);
        }
      }
    });
  });
});
