# Key Collective v4.0 — Telemetry Specification

**Version:** 4.0 | **Date:** 2026-09-14 | **Status:** Approved

---

## 1. Observability Philosophy

Non-blocking, append-only. All high-frequency events stream to **Cloudflare Workers Analytics Engine (WAE)** via `ctx.waitUntil()`. D1 writes reserved for durable state mutations only.

**Core Invariant:** No telemetry write shall add more than **2ms** to P95 proxy latency.

---

## 2. Analytics Engine Event Schemas

### 2.1 `proxy.request`
| Field | Type | Description |
|---|---|---|
| `blobs[0]` | tenant_id | HMAC-SHA256 of user ID |
| `blobs[1]` | provider | gemini/openai/groq/etc |
| `blobs[2]` | pool_type | COMMUNITY/PRIVATE |
| `blobs[3]` | routing_decision | SELF_KEY/COMMUNITY_POOL/QUOTA_JAIL_REJECT |
| `doubles[0]` | status_code | HTTP status |
| `doubles[1]` | latency_ms | Total proxy latency |
| `doubles[2]` | routing_overhead_ms | Time in routing logic |
| `doubles[3]` | cu_charged | Community Units charged |
| `indexes[0]` | timestamp | Unix seconds |

### 2.2 `pool.lifecycle`
| Field | Type | Description |
|---|---|---|
| `blobs[0]` | tenant_id | Tenant |
| `blobs[2]` | event_type | CONTRIBUTED/OBSERVATION_START/OBSERVATION_END/REVOKED/ROTATED/QUARANTINED |
| `doubles[0]` | vesting_tier | 1/2/3 |
| `doubles[1]` | burst_multiplier | 1.5/3.0/4.5 |
| `doubles[2]` | midnight_freeze_blocked | 1=blocked, 0=allowed |

### 2.3 `debt.ledger`
| Field | Type | Description |
|---|---|---|
| `blobs[0]` | tenant_id | Tenant |
| `blobs[1]` | event_type | CU_CONSUMED/DAILY_DECAY/JAIL_ENTERED/JAIL_EXITED/BADGE_GRANTED |
| `doubles[0]` | debt_before_cu | Debt before event |
| `doubles[1]` | debt_after_cu | Debt after event |
| `doubles[2]` | decay_amount_cu | CU decayed (30%/day at 00:01 UTC) |
| `doubles[3]` | jail_level | 0=none, 1=soft, 2=hard |

### 2.4 `key.ingestion`
| Field | Type | Description |
|---|---|---|
| `blobs[2]` | probe_result | VALID/INVALID/BILLING_BLOCKED/RATE_LIMITED |
| `doubles[0]` | k1_attested | 1=signed |
| `doubles[1]` | k2_attested | 1=signed |
| `doubles[2]` | turnstile_passed | 1=verified |

### 2.5 `takedown.report`
| Field | Type | Description |
|---|---|---|
| `blobs[0]` | ip_hash | SHA-256 of reporter IP |
| `doubles[0]` | match_found | 1=hash matched active pool key |
| `doubles[1]` | response_time_ms | Must be ≥200ms (timing shield) |
| `doubles[2]` | rate_limited | 1=5 req/IP/hr limit hit |

---

## 3. SLI / SLO Definitions

| SLI | Measurement | SLO Target |
|---|---|---|
| Proxy P95 Latency | WAE `latency_ms` p95 over 5min | **< 100ms** |
| Routing Overhead P95 | WAE `routing_overhead_ms` p95 | **< 5ms** |
| Takedown Response Time | WAE `response_time_ms` p99 | **≥ 200ms, ≤ 220ms** |
| Debt Decay Accuracy | D1 audit: `(debt_before × 0.7)` within ±1 CU | **100%** |
| Observation Buffer | No COMMUNITY_POOL routing within 24h of OBSERVATION_START | **100%** |
| Key Availability | % proxy requests finding a valid key | **> 99.5%** |
| Midnight Freeze | Zero pool toggles 23:30-00:30 UTC | **100%** |

---

## 4. User-Facing Telemetry (Dashboard)

| Widget | Data Source | Cadence |
|---|---|---|
| Burst Multiplier (U_pool) | KeyPoolDO in-memory | Real-time |
| Community Debt (CU) | D1 contributor_standing | Per-request |
| Daily API Usage | WAE aggregate | 5-min window |
| Key Pool Status | KeyPoolDO state | Real-time |
| Provider Health | WAE rolling 1h success rate | 5-min cache |
| Vesting Tier | D1 api_keys.vesting_tier | Per key event |
| Live Telemetry Stream | WAE tail SSE | Real-time |

---

## 5. Data Retention & Privacy

| Data Type | Retention | PII Handling |
|---|---|---|
| WAE proxy events | 30 days | tenant_id = HMAC-SHA256 — never plaintext |
| WAE debt/lifecycle events | 90 days | Same HMAC tenant hash |
| D1 consent_attestations | Indefinite (legal) | Consent version + timestamp, no personal data |
| Takedown reports | 90 days | IP as SHA-256 hash only |
| Key ciphertext | Until user deletion | AES-256-GCM + HKDF |

---

## 6. Alerting Rules

| Alert | Condition | Severity |
|---|---|---|
| High Proxy Latency | P95 > 200ms sustained 5min | 🔴 Critical |
| Provider Degradation | Success rate < 80% (1h) | 🟡 Warning |
| Debt Decay Failure | No decay events at 00:01-00:05 UTC | 🔴 Critical |
| Pool Size Critical | Community pool < 3 active keys | 🟡 Warning |
| Takedown Timing Breach | Response time < 190ms | 🔴 Critical |
