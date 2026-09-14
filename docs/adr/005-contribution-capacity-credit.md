# ADR-005: Unified Debt Model — Congestion-Gated Debt + Debt-Priority Key Selection

**Status:** Accepted  
**Date:** 2026-09-14  
**Deciders:** Orchestrator + System Architect  
**Triggered by:** Two user-identified fairness edge cases, refined across three iterations

---

## Context

The original Eye-for-an-Eye debt model failed two fairness scenarios:

**Case A — Sole contributor + sole consumer:**
A is the only contributor. Own key hits RPM. Falls to pool → dispatches A's own key.
Debt accrues. A goes to Quota Jail for consuming their own capacity via the pool routing layer.

**Case B — Multi-contributor, one active consumer (idle pool):**
A, B, C, D contribute keys. Only A is active for weeks. A draws from B/C/D's idle keys.
Debt accumulates against A alone. A hits Quota Jail — despite being the most engaged
community member and the only one keeping the pool warm.

**The Root Misunderstanding:**
Pool capacity is a **flow** (RPM resets per minute), not a **stock** (stored grain).
Idle capacity from B/C/D that A consumes would have been wasted otherwise.
The pool exists *precisely* to let active contributors burst through idle capacity.
Charging debt for idle-pool consumption defeats the product's core promise.

**The Debt-Priority Insight (User Proposal):**
Route community pool requests through the KEY belonging to the contributor with the most debt.
Their key serves others → their debt self-heals via the routing mechanism itself.
This is elegant for congested multi-user pools but cannot solve the idle-pool case alone:
when A is the sole consumer, no other member triggers the self-healing loop for A.

---

## Decision: Two Complementary Mechanisms

### Mechanism 1 — Congestion-Gated Debt (CGD)

Debt is a **congestion charge**, not a usage tax.
Debt only accrues when the tenant's consumption is actively displacing another active member.

```
pool_utilization_5min = active_pool_requests_5min / total_pool_capacity_5min

if pool_utilization_5min < CONGESTION_THRESHOLD (default: 0.80):
    debt_delta = 0                                      // Idle pool → burst freely
else:
    debt_delta = max(0, CU_consumed - own_contributed_capacity × vesting_multiplier)
```

**Solves:** Case A and Case B. Idle-pool consumption is always free.

### Mechanism 2 — Debt-Priority Key Selection (DPKS)

When selecting which pool key to dispatch (for any request, congested or not):

```
availableKeys
  .filter(k => k.provider === requestedProvider && k.health_score > 0)
  .sortBy(k => getContributorDebt(k.tenant_id), DESCENDING)
  .first()                         // Use the key owned by highest-debt contributor
```

When key K (owned by contributor X) serves tenant T's request:
```
T.debt    += debt_delta            // Charged only if pool is congested (Mechanism 1)
X.debt     = max(0, X.debt - CU_cost)  // X's key serving others reduces X's debt
X.contribution_served_micro_cu += CU_cost
```

**Solves:** Congested-pool self-healing. High-debt contributors' keys serve others most →
their debt burns down organically via routing, not via a decay cron.

### Why Both Are Needed

| Scenario | CGD Alone | DPKS Alone | Combined |
|---|---|---|---|
| Idle pool, sole consumer | ✅ zero debt | ❌ debt accrues (no healing loop) | ✅ zero debt |
| Congested pool, balanced users | ⚠️ fair but no self-healing | ✅ self-healing | ✅ fair + self-healing |
| Congested pool, dominant consumer | ✅ debt accrues correctly | ✅ dominant consumer's key serves others most | ✅ both enforce fairness |
| Free-rider (zero contribution) | ✅ full debt on congestion | ⚠️ key not prioritized, debt still accrues | ✅ free-rider ejected on congestion |

---

## Full Routing Decision Path

```
Request arrives for tenant T, provider P
│
├─[1] Self-Key Priority
│     Try T's own healthy keys for provider P first
│     → Found: dispatch, zero debt, done
│     → Exhausted: fall through ↓
│
├─[2] Read pool_utilization_5min from PoolCoordinatorDO (in-memory, zero latency)
│
├─[3] Select pool key via Debt-Priority Key Selection
│     Sort available healthy P-keys by owner.community_debt DESC
│     Pick the top key (key owned by most-indebted contributor with healthy key)
│     → If no healthy keys available: return POOL_EMPTY (503)
│
└─[4] Compute debt_delta
      if pool_utilization_5min < CONGESTION_THRESHOLD:
          debt_delta = 0               // Idle pool — free burst
      else:
          debt_delta = max(0, CU_cost - T.own_contributed_CU × T.vesting_multiplier)

      T.community_debt_micro_cu += debt_delta
      key_owner.community_debt_micro_cu = max(0, key_owner.debt - CU_cost)  // Self-heal
      key_owner.contribution_served_micro_cu += CU_cost
```

---

## Second-Order Effect: Health Sentinel Self-Tuning

Debt-Priority routing applies MORE load to high-debt contributors' keys.
Under sustained heavy use, their keys approach rate limits → `μₖ` decreases.
Lower `μₖ` → key selected less often (health filter) → natural back-pressure.
This prevents runaway routing pressure on a single contributor's key.

---

## Data Model Changes

### `PoolCoordinatorDO` in-memory (already exists for Anomalous Spiker Brake)
```typescript
pool_utilization_5min: number   // 0.0–1.0 rolling window — reuse existing counter
contributor_debt_map: Map<tenantId, bigint>  // micro-CU debt per contributor
                                              // Synced from D1 on DO warm-start
```

### `CommunityDebtLedger` (D1 `contributor_standing` table — new columns)
```typescript
daily_free_draw_micro_cu: number          // own_contributed_CU × vesting_multiplier
daily_consumed_from_pool_micro_cu: number // total CUs drawn from pool today
congestion_exempt_draws_micro_cu: number  // CUs drawn debt-free (observability)
contribution_served_micro_cu: number      // CUs served to others via DPKS (debt offset)
```

### D1 Migration 0004 amendment
```sql
ALTER TABLE contributor_standing
  ADD COLUMN daily_free_draw_micro_cu            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN daily_consumed_from_pool_micro_cu   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN congestion_exempt_draws_micro_cu    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN contribution_served_micro_cu        INTEGER NOT NULL DEFAULT 0;
```

---

## Jail Thresholds (Unchanged in Structure)

Thresholds apply to `community_debt_micro_cu` (which now only accumulates during congestion):

| State | Condition |
|---|---|
| PRISTINE | debt = 0 |
| SOFT_WARNING | debt > 0.5 × daily_free_draw_micro_cu |
| HARD_JAIL | debt > 1.0 × daily_free_draw_micro_cu |

For non-contributors (`daily_free_draw = 0`): any congestion-period draw → immediate jail.

---

## Constants

| Constant | Default | Range | Notes |
|---|---|---|---|
| `CONGESTION_THRESHOLD` | `0.80` | 0.50–0.95 | Admin-configurable. Below this = idle pool. |
| `DPKS_DEBT_FLOOR` | `0` | — | Keys with owner debt = 0 are selected round-robin |

---

## Gaming Resistance

| Attack | Mitigation |
|---|---|
| Submit dead key to get zero debt + low DPKS priority | `μₖ = 0` → key excluded from DPKS selection → no serving → no debt reduction |
| Keep pool utilization artificially high to avoid CGD protection | Pool utilization measured by upstream provider throughput consumed, not inbound request count |
| Accumulate debt intentionally to trigger DPKS priority and "burn" key quickly then rotate | Rotation triggers 30-min grace + GCP tombstone; gaming requires genuine key destruction |
| Collude with friends to stay inactive, making sole user's utilization look like "congested" | If only 1 user is making requests, pool utilization = their requests / total capacity — which will be low unless they're genuinely saturating the pool |

---

## Alternatives Considered and Rejected

| Option | Why Rejected |
|---|---|
| **DPKS alone (no CGD)** | Self-healing loop requires other active members. Fails Case B (idle pool). |
| **CGD alone (no DPKS)** | Correct for idle-pool. No self-healing in congested pools; debt only decays at midnight. |
| **Usage-measured debt (original)** | Punishes active contributors regardless of pool state. Wrong abstraction for flow capacity. |
| **Activity-weighted debt sharing** | Requires global ledger across all KeyPoolDOs. PoolCoordinatorDO becomes a financial bottleneck. |
