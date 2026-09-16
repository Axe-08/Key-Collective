/**
 * Key Collective v3 — Ephemeral Demo Tier Constants
 *
 * Conforms to:
 * - docs/system_design_v3.md (Section 3: Ephemeral Demo Tier State Machine & DO Alarm Engine)
 * - docs/adr/003-multi-project-tiered-architecture.md (Section 3: Global Demo Pool)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.3: Demo Durable Object)
 */

export const DEFAULT_ROTATION_INTERVAL_MS = 15 * 60 * 1000; // 15 Minutes (900,000 ms)
export const DEFAULT_IP_RPM_LIMIT = 1; // 1 request per minute per IP
export const DEFAULT_IP_RPD_LIMIT = 5; // 5 requests per day per IP
export const DEFAULT_GLOBAL_RPM_LIMIT = 20; // 20 requests per minute global playground ceiling
export const DEFAULT_STALE_PRUNE_MS = 60 * 60 * 1000; // 1 hour (3,600,000 ms)

export const STORAGE_KEY_TOKEN = "demo:token";
export const STORAGE_KEY_EXPIRY = "demo:expiry";
