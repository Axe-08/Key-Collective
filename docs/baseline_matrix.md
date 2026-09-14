# Baseline Routing Architecture Matrix: Key Collective v4.0

**Evaluation of Community Pool Coordination Architectures**

| Criteria | Weight | Route A (D1-Only) | Route B (DO Singleton) | Route C (DO Shards) |
|---|:---:|:---:|:---:|:---:|
| **Routing Latency (<5ms)** | 5 | 1/5 — D1 hot-path ~15ms | **4/5 — in-memory <2ms** | 5/5 — global <1ms |
| **Data Consistency** | 4 | 5/5 — ACID SQLite | **4/5 — atomic per DO** | 2/5 — eventual CRDT |
| **Operational Complexity** | 4 | 4/5 — simple SQL | **4/5 — standard DO** | 1/5 — complex sync |
| **Cost (D1 IOPS)** | 3 | 2/5 — high D1 IO | **5/5 — DO compute cheap** | 3/5 — cross-shard cost |
| **Scalability** | 4 | 2/5 — D1 concurrency cap | **4/5 — high RPS single DO** | 5/5 — horizontal |
| **Weighted Total** | — | **55/100** | **83/100 ✅ SELECTED** | **66/100** |

### Summary

**Route B (PoolCoordinatorDO Singleton)** is the recommended architecture.

- **Route A rejected:** D1 hot-path latency (5-20ms per read) already violates the <5ms routing SLA. D1 connection concurrency limits hit at ~500 RPS.
- **Route B selected:** In-memory DO state provides <2ms routing decisions. Atomic mutations eliminate race conditions. 5-min sliding windows (Anomalous Spiker Brake) trivially maintainable in-memory. Cold start rebuilds from D1 in <500ms.
- **Route C rejected:** CRDT merge conflicts on debt ledger are non-trivial. Per-region DO sharding is premature optimization for <10k active tenants. Revisit at 100k+ tenants.
