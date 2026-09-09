---
file: docs/codeflow/durable_object_key_pool_cfg.md
project: Key Collective v2
purity: [🔴 State Mutating]
cyclomatic_avg: 18
date: 2026-09-10
tags: [type/codeflow, Key Collective v2]
---

# 📄 Codeflow: `docs/codeflow/durable_object_key_pool_cfg.md`

> **Module Responsibility:** Manages tenant key pools, applies capability filtering and priority weighting, and enforces circuit breaker state transitions in memory and storage.
> **Purity Profile:** `🔴 State Mutating`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        RouterHandler[router_handler.ts]
    end
    subgraph `src/durable_objects/`
        KeyPoolDO[KeyPoolDO fetch]
        KeySelector[key_selector.ts]
        CircuitBreaker[circuit_breaker.ts]
    end
    subgraph Callees
        DOStorage[(DO this.ctx.storage)]
        UpstreamProxy[upstream_client.ts]
    end
    RouterHandler --> KeyPoolDO
    KeyPoolDO --> DOStorage
    KeyPoolDO --> KeySelector
    KeySelector --> CircuitBreaker
    KeyPoolDO --> UpstreamProxy
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def processProxyRequest(req: Request) -> Promise<Response>`
* **Purity:** `🔴 State Mutating`
* **Complexity:** Cyclomatic: `20` | Cognitive: `25`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    A[DO fetch invocation] --> B[DO state hydration from this.ctx.storage]
    B --> C[Key selection with capability filtering]
    C --> D[Priority weighting & selection]
    D --> E{Circuit Breaker State}
    E -- Open --> F[Reject Request / Fallback Key]
    E -- Closed/HalfOpen --> G[Proxy Request Upstream]
    G --> H{Response Status}
    H -- Success --> I[Record Success, State -> Closed]
    H -- Failure/Timeout --> J[Record Failure, State -> Open]
    I --> K[Transactional storage commit on state changes]
    J --> K
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `keys` | DO Storage | Capability filtered, weighted | Used for Upstream proxy auth |
| `cb_state` | DO Memory / Storage | Updated based on error rates | Transactional commit to DO Storage |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** High concurrency causing contention on DO storage transactions.
- ⚠️ **Edge Case 2:** Upstream provider total outage causing all keys to trip circuit breaker.

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Isolate circuit breaker transition logic into pure functions.
- **Strengths:** Robust state hydration, transactional integrity for hot state.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]] — Used in Codebase Scribe & Cartographer
- [[Templates-Index]] — Master Index of Workflows
