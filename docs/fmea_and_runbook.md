# FMEA & Runbook: Key Collective v4.0

**Date:** 2026-09-14 | **Methodology:** FMEA (Severity × Occurrence × Detection = RPN)

---

## 1. FMEA Table

| Failure Mode | Effect | Sev (1-10) | Occ (1-10) | Det (1-10) | RPN | Mitigation |
|---|---|:---:|:---:|:---:|:---:|---|
| **PoolCoordinatorDO Eviction** | Global communal routing stalls; fallback to private keys only | 8 | 4 | 9 | 288 | DO alarm keeps minimum 10-min uptime; Worker-side fallback to private-only mode |
| **D1 Migration Failure (0002-0004)** | v3.5 schema out of sync with v4.0; potential data corruption | 10 | 2 | 8 | 160 | Blue/Green deployment; mandatory pre-migration D1 backup via `wrangler d1 export` |
| **KeyPoolDO Cold Start During Burst** | High latency or 5xx on initial request after DO eviction | 7 | 6 | 8 | 336 | Pre-warming alarms; edge Worker queues concurrent requests for <500ms during cold start |
| **Turnstile API Outage** | New users/keys cannot be registered | 6 | 3 | 10 | 180 | Fail-open mode for pre-verified IPs; degraded registration path with IP-only fallback |
| **Community Debt Ledger Corruption** | Unfair quota allocation; Quota Jail bypass | 9 | 2 | 7 | 126 | Dual-write verification; nightly reconciliation cron (D1 vs. DO in-memory) |
| **Midnight Freeze Clock Skew** | Pool toggle arbitrage; V17 bypass | 5 | 5 | 6 | 150 | Inject timestamp from single CF edge origin; DO timestamps only from Worker, not wall clock |
| **HKDF Master Key Compromise** | All tenant keys potentially decryptable | 10 | 1 | 8 | 80 | Rotatable master key procedure; per-tenant re-encryption on rotation |
| **Upstream Provider API Change** | Error normalizer fails; V14 risk elevated | 7 | 5 | 6 | 210 | Catch-all error envelope; alert on unrecognized upstream error shapes |
| **GCP Hash Collision in Takedown Set** | False positive key revocation | 4 | 1 | 9 | 36 | SHA-256 collision probability negligible; log all hash matches for audit |
| **Anomalous Spiker Counter Reset** | 35% cap bypass after DO eviction | 6 | 4 | 7 | 168 | DO alarm ensures minimum uptime; conservative 30% cap (5% headroom for reset jitter) |

---

## 2. Runbooks for Critical Failures

### CRIT-1: PoolCoordinatorDO Eviction or Hang (RPN 288)
**Symptoms:** Spike in 502/504 on communal requests; P95 routing latency >2s; WAE shows `routing_decision=COMMUNITY_POOL` but latency spike.

**Steps:**
1. Check CF Dashboard → Durable Objects → `POOL_COORDINATOR` → CPU and memory metrics
2. If memory >128MB or CPU consistently >90%, deploy emergency user-limit patch to block top 5% heavy consumers
3. Force reset: `wrangler d1 execute --env production --command "SELECT COUNT(*) FROM api_keys WHERE community_routing_status='ACTIVE'"` to confirm D1 state is intact
4. Send admin request: `POST /admin/do/coordinator/reset` with signed admin JWT
5. Monitor fallback private-routing success rate in WAE for 15 minutes

**Recovery Criterion:** `routing_decision=COMMUNITY_POOL` resumes within 5 minutes of DO restart.

---

### CRIT-2: D1 Migration Failure (RPN 160)
**Symptoms:** TypeScript type errors on `api_keys.pool_type`; 500s on key registration; health check `GET /api/health` returns schema mismatch.

**Steps:**
1. Immediately roll back deployment: `wrangler deploy --env production --rollback`
2. Export current D1 state: `wrangler d1 export key-collective-d1 --env production --output backup_$(date +%Y%m%d).sql`
3. Run migration on staging first: `wrangler d1 execute key-collective-d1-dev --file src/migrations/0002_commons_pooling.sql`
4. Validate staging with golden tests: `make test`
5. Re-run on production during low-traffic window (03:00-05:00 UTC)

**Recovery Criterion:** `make gate` passes on production; key registration succeeds end-to-end.

---

### CRIT-3: Downstream Error Leakage Detected (RPN 210)
**Symptoms:** Admin alert fires on outbound payload containing forbidden strings (`googleapis.com`, `projects/`); WAE shows anomalous `status_code=400` with large response body.

**Steps:**
1. Identify unhandled error format from WAE `proxy.request` events (check `blobs[1]` for provider)
2. Pull last 100 responses from that provider: `wrangler tail --env production --format json | grep -A5 '"provider":"<provider>"'`
3. Hotfix `src/worker/normalizer.ts` to catch the new error shape
4. Deploy immediately: `make gate && wrangler deploy --env production`
5. Backfill WAE audit log entry for the incident

**Recovery Criterion:** Zero occurrences of forbidden strings in outbound payloads for 1 hour.

---

### CRIT-4: Community Debt Ledger Corruption (RPN 126)
**Symptoms:** Users reporting multiplier doesn't match their contributions; negative debt values in D1; WAE `debt.ledger` events show inconsistent `debt_before_cu` vs `debt_after_cu` deltas.

**Steps:**
1. Enable read-only mode: `wrangler kv:key put --env production MAINTENANCE_MODE true`
2. Run audit query: `wrangler d1 execute --command "SELECT tenant_id, community_debt_micro_cu, last_decay_date FROM contributor_standing ORDER BY community_debt_micro_cu DESC LIMIT 50"`
3. Compare against WAE `debt.ledger` events for the last 24h
4. Identify corrupted tenants; apply corrective CU patch via admin endpoint
5. Disable maintenance mode; trigger immediate nightly reconciliation cron

---

## 3. Operational Runbook — Midnight Debt Decay Failure
**Symptoms:** No `DAILY_DECAY` events in WAE `debt.ledger` at 00:01-00:10 UTC; contributor standings show stale `last_decay_date`.

**Steps:**
1. Check CF Workers Cron Trigger logs for `daily-debt-decay` trigger
2. If cron fired but DO was unavailable: manually trigger `POST /admin/cron/debt-decay` with admin JWT
3. Verify: `wrangler d1 execute --command "SELECT MAX(last_decay_date) FROM contributor_standing"`
4. If cron didn't fire: check CF dashboard for cron trigger configuration mismatch

**Recovery:** All `last_decay_date` values should show today's UTC date within 10 minutes.
