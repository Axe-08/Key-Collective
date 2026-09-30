# 🗺️ Codeflow: PoolCoordinatorDO & Emergency Braking Engine

> **Subsystem:** `src/pool/coordinator_do.ts` & `src/durable_objects/`  
> **Source Files:** `src/pool/coordinator_do.ts`, `src/durable_objects/key_selector/`  
> **Quality Gate:** Strict TypeScript Mode · Durable Object Transactional Storage  

---

## 1. Subsystem Overview
`PoolCoordinatorDO` is the global actor singleton coordinating multi-tenant capacity exchange. It enforces:
- **Anomalous Spiker Brake:** Detects single-tenant pool saturation (>35% of total sliding 5-minute pool volume) and temporarily throttles that tenant to preserve communal QoS.
- **Provider Key Selection:** Matches requests against active, non-quarantined keys in the community pool.
- **Async D1 Sync:** Flushes in-memory coordination stats to D1 asynchronously every 30s.

---

## 2. Control Flow Graph (CFG)

```mermaid
flowchart TD
    Start([/coordinator/report-volume or /coordinator/update-provider]) --> RouteCheck{Endpoint?}
    
    RouteCheck -->|report-volume| ExtractTenant[Extract Calling Tenant & Volume]
    ExtractTenant --> CalcWindow[Evaluate Sliding 5-Minute Volume Window]
    CalcWindow --> SpikerCheck{Tenant Share > 35%\nTotal Window Volume?}
    
    SpikerCheck -->|Yes - Spike Detected| BrakeEngaged[Engage 60s Emergency Brake]
    BrakeEngaged --> LogBrake[Persist activeBrakes to D1]
    LogBrake --> BrakeApplied[Return brakeApplied: true]
    
    SpikerCheck -->|No - Safe| SafeReturn[Return brakeApplied: false]
    
    RouteCheck -->|update-provider| ExtractStats[Extract activeKeys, quarantineKeys, latencyMs]
    ExtractStats --> ComputeRatio[ratio = activeKeys / totalKeys]
    ComputeRatio --> CalcWeight[wProvider = ratio * (1000 / latencyMs)]
    CalcWeight --> PersistProvider[Persist provider stats to D1]
    PersistProvider --> ReturnWeight[Return wProvider]
```

---

## 3. Def-Use Variable Lifecycle Matrix

| Variable | Scope / Type | Def Site | Use Sites | Purity Badge |
|---|---|---|---|---|
| `tenantVolumeWindow` | `Map<string, int64>` | `recordLease` / Timer Alarm | `spikerCheck`, `slidingWindowSum` | 🔴 State Mutating |
| `totalPoolVolume` | `int64` | In-memory Counter | Spiker Threshold Ratio Calculation | 🔴 State Mutating |
| `activeKeysMap` | `Map<string, KeyMetadata>`| DO Hydration from D1 | `filterHealthyKeys`, `sortWeights` | 🟡 I/O Bound |
| `qualityWeight` | `number` | `sortWeights` | `pickOptimal` comparator | 🟢 Pure |
