# Part 4: End-to-End Execution Lifecycles & Dynamic Tracing

Welcome to Part 4 of the Key Collective University Textbook. 

While earlier sections analyzed isolated architectural components, data contracts, and cryptographic foundations, this module examines how those components interact dynamically when real user requests traverse Cloudflare's global edge network.

## Module Structure and Reading Roadmap

1. [Chapter 4.1: Direct Private Key Inference & The Sub-15ms Hot-Path](./04_1_direct_private_key_hotpath.md)
   - Traces the primary artery for tenant-owned credentials.
   - Dissects the latency budget: TLS termination (<2ms), in-memory actor lookup (<1ms), AES-256-GCM decryption (<0.1ms), and zero-copy streaming pipelines.
   - Explores the execution mechanics of `KeyPoolDO` and non-blocking telemetry via `ctx.waitUntil()`.

2. [Chapter 4.2: Communal Failover, Lease Allocation & Debt Settlement Flow](./04_2_communal_failover_and_debt_settlement.md)
   - Traces the dynamic failover cascade when a private key is exhausted by HTTP 429 rate limits.
   - Details lease acquisition from `PoolCoordinatorDO`, non-blocking proxying, usage token extraction, and double-entry microdollar debt mutations in `TenantQuotaDO`.

3. [Chapter 4.3: Anti-Cheat Sentinel, Key Invalidation & Auto-Mediation Flow](./04_3_anti_cheat_and_auto_mediation.md)
   - Explores the defensive sentinels that safeguard the reciprocal economy against fraudulent and revoked credentials.
   - Covers 5-layer anti-sybil ingress evaluation, zero-cost error-inducing synthetic probes (`forceErrorGcpProbe`), automated key quarantine, and programmatic credit clawback arbitration.

4. [Chapter 4.4: Zero-Leak Error Sanitization, Upstream Outages & Emergency Brake](./04_4_error_sanitization_and_emergency_brake.md)
   - Analyzes upstream provider outages (500, 502, 503, 529) and downstream error defense.
   - Details the `ErrorNormalizer` regex redaction pipeline, header allow-listing, and three-state circuit breakers (`CircuitBreakerDO`) that halt edge stampedes.

## Architectural Invariants Enforced Across All Flows

Every execution lifecycle documented in this module strictly enforces our core invariants:
- **Sub-15ms Edge Overhead**: Proxy processing time is deterministically bounded to protect Time to First Token (TTFT).
- **Fixed-Point Ledger Mathematics**: All communal transactions are accounted strictly in `int64` microdollars ($1\text{ USD} = 1,000,000\text{ µ\$}$) to eliminate floating-point drift.
- **Zero Plaintext Secrets**: Raw API keys exist only in transient V8 isolate heap memory during active upstream HTTP dispatches and are never logged or stored unencrypted.
- **Defensive Data Boundaries**: Upstream provider metadata, internal project IDs, and caller IP addresses are stripped before responses exit the edge perimeter.

## Verification Checklist for Execution Flows

Before advancing to Part 5, ensure you can trace each request step mentally:
- Can you explain what happens when a client sends a malformed `Authorization` header?
- Can you map how `PoolCoordinatorDO` serializes concurrent key requests without Redis locks?
- Can you verify how `createErrorSanitizerTransform` masks secrets in a streaming HTTP chunk?

## Architectural Verification Checkpoint

All flows in this module must be verified through the test harness before deploying to production edge environments. Run `make gate` to ensure that direct private key dispatches, communal failovers, anti-cheat sentinels, and error normalizers execute deterministically within the sub-10 second quality gate budget.
