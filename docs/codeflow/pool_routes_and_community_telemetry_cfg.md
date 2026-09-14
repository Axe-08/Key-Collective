---
file: src/worker/pool_routes.ts
project: Key-Collective
purity: 🟡 I/O Bound
cyclomatic_avg: 2.9
date: 2026-09-15
tags: [type/codeflow, Key-Collective, edge-worker, telemetry, community-pool]
---

# 📄 Codeflow: `src/worker/pool_routes.ts`

> **Module Responsibility:** Cloudflare Worker edge routes for community pool analytics, contributor standing, capacity multiplier computation, and jail status enforcement.
> **Purity Profile:** `🟡 I/O Bound` (executes D1 relational queries and returns snapshot telemetry).

---

## 1. 🕸️ Inbound & Outbound Dependency Graph

```mermaid
graph LR
    subgraph Inbound
        EdgeRouter["src/worker/index.ts"]
    end
    subgraph `src/worker/pool_routes.ts`
        HandleTelemetry["handlePoolTelemetry(env, tenantId)"]
        HandleStanding["handlePoolStanding(env, tenantId)"]
        HandleContrib["handlePoolContribution(env, tenantId)"]
        HandleNotifs["handleNotifications(env, tenantId)"]
    end
    subgraph Persistence
        D1Keys["D1 api_keys Table"]
        D1Standing["D1 contributor_standing Table"]
        D1Notifs["D1 notifications Table"]
    end

    EdgeRouter --> HandleTelemetry
    EdgeRouter --> HandleStanding
    EdgeRouter --> HandleContrib
    EdgeRouter --> HandleNotifs
    HandleTelemetry --> D1Keys
    HandleStanding --> D1Standing
    HandleContrib --> D1Keys
    HandleNotifs --> D1Notifs
```

---

## 2. 🔍 Core Function Logic & Control Flow Deep Dive

### `handlePoolStanding(env: WorkerEnv, tenantId: string): Promise<Response>`
* **Purity:** `🟡 I/O Bound`
* **Complexity:** Cyclomatic: 5 | Cognitive: 4

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Req([Inbound GET /api/pool/standing]) --> D1Check{D1 database available?}
    D1Check -->|No| Err503[Return HTTP 503 Database Unavailable]
    D1Check -->|Yes| QueryStanding[SELECT from contributor_standing WHERE tenant_id = ?]
    
    QueryStanding --> RowCheck{Row found?}
    RowCheck -->|No| RetDefault[Return Pristine Default: multiplier=1.5, ceiling=4.5, debt=0]
    RowCheck -->|Yes| ParseMetrics[Extract debt_micro_cu, daily_contributed_cu, current_multiplier]
    
    ParseMetrics --> DebtRatioCalc{contributed > 0?}
    DebtRatioCalc -->|No| JailPristine[jailStatus = 'PRISTINE']
    DebtRatioCalc -->|Yes| RatioCheck{debt / contributed}
    
    RatioCheck -->|> 1.0| SetHardJail[jailStatus = 'HARD_JAIL']
    RatioCheck -->|> 0.5| SetSoftWarning[jailStatus = 'SOFT_WARNING']
    RatioCheck -->|<= 0.5| SetPristine[jailStatus = 'PRISTINE']
    
    SetHardJail --> AssembleJSON[Assemble standing JSON payload]
    SetSoftWarning --> AssembleJSON
    SetPristine --> AssembleJSON
    JailPristine --> AssembleJSON
    RetDefault --> End([Return Response])
    AssembleJSON --> End
    Err503 --> End
```

#### Def-Use Data Flow Matrix: `handlePoolStanding`
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `tenantId` | Authenticated Context | Validated string | Bound to SQL query parameter |
| `row.community_debt_micro_cu` | D1 Database | Micro-Compute Units | Ratio computed against `daily_contributed_cu` |
| `jailStatus` | Conditional Evaluation | `'PRISTINE' \| 'SOFT_WARNING' \| 'HARD_JAIL'` | Emitted in JSON payload for frontend badge display |

---

## 3. 🛠️ Code Review & Invariant Verification
- **Strict Ratio Enforcement:** When `community_debt_micro_cu / daily_contributed_cu > 1.0`, the system automatically flags `HARD_JAIL`, causing downstream DO quota evaluation to restrict the tenant to probationary limits (2 RPM / 50 RPD).
