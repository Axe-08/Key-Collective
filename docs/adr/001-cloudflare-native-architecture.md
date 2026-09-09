# ADR 001 — Cloudflare-Native Architecture for Key Collective v2

**Status:** Accepted  
**Date:** 2026-09-09  
**Deciders:** Lead Architect (User), Inception Board v2.0

---

## Context

Key Collective v1 is a single Go binary deployed on Railway Free Tier. The long-term vision is a globally-distributed, multi-tenant LLM router SaaS. Railway's pricing model (always-on containers billed per-second) scales linearly with users and carries $0.05/GB egress — a critical cost driver for a proxy whose entire job is streaming large LLM response payloads. A replatform under traffic pressure costs 3–4x more engineering effort than a clean architectural decision now.

## Decision

Replatform Key Collective v2 entirely onto **Cloudflare's developer platform** using the **Workers-First (Route A)** architecture:

| Layer | Technology | Replaces |
|---|---|---|
| Edge auth + rate limiting | Cloudflare Workers (TypeScript) | In-process Go middleware |
| Stateful hot path (circuit breaker, key pool, RPM) | Cloudflare Durable Objects | In-memory Go struct + mutex |
| Proxy hot path (decrypt, rewrite, relay) | Cloudflare Containers — Go `lite` (1/16 vCPU, 256MB) | Railway Go binary |
| Persistent storage (keys, model registry, cost ledger) | Cloudflare D1 (SQLite-compatible) | SQLite WAL on Railway volume |
| Async telemetry | Cloudflare Workers Analytics Engine | Buffered channel → SQLite |

**Language:** Go retained for the Container layer. Python rejected — 2.5–3× higher container cost at every scale tier due to larger instance requirements (Python: `basic` 1/4 vCPU / 1GiB vs Go: `lite` 1/16 vCPU / 256MB) and 10–20× worse cold start latency (500ms–2s vs ~50ms).

## Cost Rationale

| Scale | Railway (est.) | Cloudflare (Go) |
|---|---|---|
| 1M req/mo | $5–15 | $0 |
| 10M req/mo | $150–500 + $50 egress | $4.65 |
| 100M req/mo | $3,000–8,000 + $500 egress | $66.43 |

Cloudflare's 1TB/mo free egress alone saves $500+/mo at SaaS scale versus Railway.

## Key Architectural Invariants (v2)

1. **No blocking I/O on the hot path.** The Worker must resolve auth + model alias in < 10ms before dispatching to the Durable Object.
2. **Durable Object is the single source of truth for in-flight state.** Circuit breaker, RPM counters, and key pool live in DO memory — never reconstructed from D1 on every request.
3. **Container is stateless.** The Go container receives a fully-resolved key from the DO and performs only decryption + HTTP relay. It can be killed and restarted without state loss.
4. **D1 for persistence, Analytics Engine for telemetry.** D1 writes are limited to key mutations, model registry sync, and cost ledger rollups. High-frequency per-request events go to Analytics Engine ($0.25/M vs $1.00/M for D1 writes).
5. **Logical model aliases mandatory.** Clients never specify physical model versions. The Worker resolves aliases against the D1 model registry.

## Migration Path from v1

- v1 Railway deployment remains live until Cloudflare stack passes golden test suite
- SQLite keys exported via `GET /api/keys` endpoint, re-imported to D1 via migration script
- v1 decommissioned after 30-day parallel run with zero incident rate

## Consequences

- **Positive:** Global edge deployment, $0 egress, per-request billing, auto-scaling
- **Positive:** Durable Objects eliminate the biggest v1 fragility (in-memory state lost on restart)
- **Negative:** Container disk is ephemeral — SQLite file cannot be used locally inside Container. All persistence must go through D1 bindings.
- **Negative:** Durable Object is a new programming model; local dev requires `wrangler dev`
- **Negative:** Cold starts remain 1–3s on Containers; mitigated by DO keepalive pings every 8 minutes

## Deferred to v3

- Route C (Durable Object as full coordinator / "brain") — correct long-term architecture but requires DO SQLite beta stabilisation
- Multi-region D1 read replicas (currently in beta)
- Auto-scaling Container instances (Cloudflare roadmap item, not GA)
