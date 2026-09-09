---
file: docs/codeflow/durable_object_key_pool_cfg.md
project: Key Collective
purity: [🔴 State Mutating]
cyclomatic_avg: 4
date: 2026-09-10
tags: [type/codeflow, Key Collective]
---

# 📄 Codeflow: `docs/codeflow/durable_object_key_pool_cfg.md`

> **Module Responsibility:** Tenant-isolated Durable Objects for managing API keys, tracking rate limits, and implementing circuit breaking.
> **Purity Profile:** `🔴 State Mutating`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        RouterHandler[Router Handler]
    end
    subgraph `durable_object_key_pool`
        KeyPoolDO_fetch[KeyPoolDO.fetch]
        KeyPoolDO_getKey[KeyPoolDO.getKey]
        CircuitBreaker_recordFailure[CircuitBreaker.recordFailure]
        CircuitBreaker_transitionTo[CircuitBreaker.transitionTo]
        KeySelector_selectKey[KeySelector.selectKey]
        RateLimiter_consume[RateLimiter.consume]
    end
    subgraph Callees
        DO_Storage[Durable Object Storage]
        UpstreamClient[Upstream Client]
    end

    RouterHandler --> KeyPoolDO_fetch
    RouterHandler --> KeyPoolDO_getKey
    KeyPoolDO_getKey --> KeySelector_selectKey
    KeySelector_selectKey --> RateLimiter_consume
    KeySelector_selectKey --> CircuitBreaker_recordFailure
    KeyPoolDO_fetch --> DO_Storage
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def KeyPoolDO.getKey(provider) -> string`
* **Purity:** `🔴 State Mutating`
* **Complexity:** Cyclomatic: `5` | Cognitive: `6`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: getKey] --> ReadState[Read Keys for Provider]
    ReadState --> HasKeys{Pool Empty?}
    HasKeys -- Yes --> ThrowEmpty[Throw KeyNotFoundError]
    HasKeys -- No --> IterateKeys[Evaluate Keys via Selector]
    IterateKeys --> CheckCB{Circuit Breaker Open?}
    CheckCB -- Yes --> SkipKey[Skip Key]
    CheckCB -- No --> CheckRate{Rate Limit OK?}
    CheckRate -- No --> SkipKey
    CheckRate -- Yes --> SelectKey[Select Key]
    SelectKey --> IncrementRate[Consume Rate Limit Token]
    IncrementRate --> ReturnKey[Return Key ID]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `provider` | Argument | Mapped to DO key list | Used for storage query |
| `keyId` | DO Storage | Verified | Returned to caller |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** All keys for a provider are rate limited or broken.
- ⚠️ **Edge Case 2:** Concurrency spikes causing rate limit race conditions (mitigated by DO single-threaded execution).

---

### `def CircuitBreaker.recordFailure(keyId) -> void`
* **Purity:** `🔴 State Mutating`
* **Complexity:** Cyclomatic: `4` | Cognitive: `4`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: recordFailure] --> IncFailCount[Increment Failure Count]
    IncFailCount --> CheckThreshold{Threshold Exceeded?}
    CheckThreshold -- No --> Exit[Return]
    CheckThreshold -- Yes --> TransOpen[transitionTo OPEN]
    TransOpen --> StartTimer[Start Reset Timeout]
    StartTimer --> Exit
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `keyId` | Argument | Mapped to state | Mutates CB state |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Consecutive failures triggering rapid OPEN state.

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Ensure rate limiter consumption is atomic.
- **Strengths:** Robust isolation using Durable Objects.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]]
- [[Templates-Index]]
