# ADR-004: Commons Routing Architecture — PoolCoordinatorDO Singleton

**Date:** 2026-09-14  
**Status:** Accepted  
**Deciders:** Principal Systems Architect, Lead Architect (User)  
**Supersedes:** Portions of ADR-001-v3.5 (round-robin CascadeRouter)

---

## Context

Key Collective v4.0 introduces the Reciprocal Commons — a community pool where tenants contribute their idle API keys and can draw from others' idle capacity under Eye-for-an-Eye fairness rules. This requires a **global coordination layer** that:

1. Maintains a real-time registry of all `COMMUNITY_ACTIVE` keys (by provider + vesting tier)
2. Tracks per-tenant traffic share for Anomalous Spiker Brake (5-minute sliding window, 35% cap)
3. Selects the optimal key using $W_{\text{provider}}$ quality weights
4. Enforces Eye-for-an-Eye provider matching (can only draw from pool for providers you contribute to)
5. Operates within the <5ms routing overhead SLA budget

The system must remain correct under concurrent tenant requests without introducing synchronization overhead that would breach the latency SLA.

---

## Options Considered

### Route A: D1-Only Coordination
All pool state (active keys, traffic counters) stored in D1 SQLite. Routing logic reads from D1 on every request.

**Pros:** Strong ACID guarantees, simple operational model, no new CF primitives  
**Cons:** D1 hot-path latency is 5-20ms per read — already exceeds routing SLA. Connection concurrency limits hit at ~500 RPS.

### Route B: PoolCoordinatorDO Singleton (SELECTED)
A single global Durable Object maintains pool state in-memory. All community routing decisions go through this singleton. Flushes to D1 asynchronously.

**Pros:** <2ms in-memory access, atomic serialized mutations, 5-min sliding windows trivially in-memory, existing CF primitive  
**Cons:** Single DO location = geographic bias (workers in WNAM are closer). In-memory state reset on eviction (counters only, not keys — keys are in D1).

### Route C: Per-Region DO Shards + CRDT Sync
Regional DOs (US/EU/ASIA) shard the pool. Global state synced via D1 as CRDT merge log.

**Pros:** Optimal global latency, horizontal scalability  
**Cons:** Extreme implementation complexity. CRDT merge conflicts on debt ledger are non-trivial. Overkill for <10k active tenants. Violates v4.0 simplicity requirement.

---

## Decision Matrix

| Criteria | Weight | Route A (D1) | Route B (DO Singleton) | Route C (Shards) |
|---|:---:|:---:|:---:|:---:|
| **Routing Latency (<5ms)** | 5 | 1/5 | **4/5** | 5/5 |
| **Data Consistency** | 4 | 5/5 | **4/5** | 2/5 |
| **Operational Complexity** | 4 | 5/5 | **4/5** | 1/5 |
| **Cost (D1 IOPS)** | 3 | 2/5 | **5/5** | 3/5 |
| **Scalability** | 4 | 2/5 | **4/5** | 5/5 |
| **Weighted Total** | — | 55/100 | **83/100** | 66/100 |

---

## Decision

**Route B (PoolCoordinatorDO Singleton)** is adopted.

**Instantiation:** `env.POOL_COORDINATOR.idFromName("global")` — single instance, no per-tenant sharding.

**State boundary:**
- IN MEMORY (ephemeral): Active key list per provider, per-tenant 5-min traffic counters, $W_{\text{provider}}$ quality scores
- IN D1 (durable): `contributor_standing` table, `api_keys.community_routing_status`, all consent attestations

**Eviction resilience:** On DO cold start, PoolCoordinatorDO rebuilds its active key registry from D1 (`SELECT key_id, provider, vesting_tier FROM api_keys WHERE community_routing_status='ACTIVE'`). Rebuild takes <500ms — acceptable for cold starts.

---

## Consequences

**Positive:**
- Routing overhead consistently <5ms P95 (measured in KeyPoolDO warm state)
- Zero D1 reads on hot proxy path (key material cached in KeyPoolDO, routing in PoolCoordinatorDO)
- Anomalous Spiker Brake with 5-min sliding window requires no DB queries

**Negative:**
- Single DO location introduces ~10-30ms geographic bias for tenants far from CF's nearest datacenter (acceptable for v4.0)
- DO eviction resets in-memory spiker counters (security implication: attacker could force eviction to reset 35% cap — mitigated by alarm-based minimum 10-min uptime)

**Risks:**
- PoolCoordinatorDO becomes a single point of failure — mitigated by automatic CF DO restart + fallback to private-key-only routing on DO unavailability (graceful degradation)

---

## Rejected Alternatives

- **Route A (D1-only):** Rejected due to latency ceiling of ~15ms per D1 read on hot path
- **Route C (Shards):** Rejected as premature optimization; revisit at 100k+ active tenants

---

## Related ADRs

- ADR-001: Cloudflare Native Architecture (Workers + DO foundation)
- ADR-002: Key Encryption and Logging (AES-256-GCM, Analytics Engine)
- ADR-003: Obsidian Edge Design System (Frontend architecture)
