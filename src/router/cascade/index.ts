/**
 * Key Collective v2 — Cascade Router Subsystem
 *
 * Conforms to:
 * - LLD 2.3: Orchestrates multi-model cascade routing.
 *   - Implements RouterContract (route(request) method).
 *   - Selects the cheapest capable model using CapabilityFilter and ModelRegistry.
 *   - Implements fallback mechanisms and escalation on failure.
 *   - Interfaces with KeyPoolContract to obtain provider keys and record results/usage.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All pricing calculations utilize int64 / bigint microdollars. Zero floating-point math.
 * - Non-blocking hot path: Non-blocking telemetry and key result recording.
 */

export * from "./types";
export * from "./evaluator";
export * from "./fallback";
export * from "./router";

