# Chapter 5.3: SRE Runbooks, Edge Failure Modes & Disaster Recovery

In a globally distributed, multi-tenant API gateway processing mission-critical AI traffic, edge anomalies and upstream outages are unavoidable. When production alarms trigger, Site Reliability Engineers (SREs) and on-call developers must execute prescriptive, deterministic runbooks rather than improvising under stress.

This chapter documents the production runbooks for Key Collective, covering triage procedures, severity ratings, diagnostic commands, and immediate remediation workflows.

---

## RUNBOOK-01: D1 SQLite Outage or Database Lock Saturation

- **Severity Classification**: SEV-2 (Degraded Operations)
- **Affected Subsystems**: Storage Adapter (`src/storage/d1/adapter.ts`), API Key Repository
- **Trigger Condition**: Alert triggers when D1 write error rate exceeds $1.0\%$ over a 3-minute window, or error logs exhibit `D1_ERROR: database is locked`.

### Diagnostic Workflow
Execute diagnostic queries using the Cloudflare Wrangler CLI:
```bash
# Verify D1 cluster responsiveness and read latency
pnpm wrangler d1 execute key-collective-db --command "SELECT 1;"

# Check active key distribution and database status
pnpm wrangler d1 execute key-collective-db --command \
  "SELECT status, count(*) FROM api_keys GROUP BY status;"
```

### Remediation Protocol
1. **Activate Storage Buffer Mode**: Flip the runtime environment flag `STORAGE_BUFFER_MODE=true` in the Cloudflare Dashboard to halt non-critical D1 writes.
2. **Buffer in Durable Object Memory**: During buffer mode, `KeyPoolDO` and `TenantQuotaDO` record state mutations exclusively to `this.ctx.storage`, bypassing D1 SQLite.
3. **Drain Buffered Updates**: Once D1 write locks subside, execute the batch sync script to flush pending state from Durable Objects to D1 in serialized transactions.

---

## RUNBOOK-02: Durable Object Memory Eviction & Cold Start Latency Spike

- **Severity Classification**: SEV-3 (Performance Degradation)
- **Affected Subsystems**: Tenant Key Pool Actors (`src/durable_objects/key_pool_do.ts`)
- **Trigger Condition**: P99 Time to First Token (TTFT) exceeds $250\text{ms}$ on private key routes, accompanied by Cloudflare metrics indicating isolate memory pressure.

### Diagnostic Workflow
Tail edge logs to isolate cold-start events and inspect isolate memory consumption:
```bash
# Filter live worker logs for isolate hydration events
pnpm wrangler tail | grep "COLD_START_HYDRATION"

# Inspect DO memory utilization and execution durations
pnpm wrangler tail --format=json | jq 'select(.event.executionTime > 50)'
```

### Remediation Protocol
1. **Optimize Hydration Payload**: Verify that `this.ctx.storage.get()` loads only active API keys rather than historical usage archives or expired sessions.
2. **Deploy Keep-Alive Probes**: For high-volume enterprise tenants, activate synthetic ping crons that issue keep-alive pings every 4 minutes, preventing idle isolate eviction during core business hours.
3. **Trim In-Memory Sliding Windows**: Evict rate-limit bucket timestamps older than 60 seconds to release V8 heap memory.

---

## RUNBOOK-03: Upstream Provider Cascading 503 Outage & Throttling Stampede

- **Severity Classification**: SEV-1 (Critical Availability Incident)
- **Affected Subsystems**: Upstream Client (`src/proxy/upstream/client.ts`), Circuit Breaker
- **Trigger Condition**: Upstream provider (e.g., Anthropic or OpenAI) returns HTTP 500, 502, 503, or 529 on $>25\%$ of requests over 60 seconds.

### Diagnostic Workflow
```bash
# Tail live logs for upstream status codes
pnpm wrangler tail | grep "UPSTREAM_STATUS"
```

### Remediation Protocol
1. **Verify Automated Circuit Breaker Trip**: Check that `CircuitBreakerDO` has transitioned from `CLOSED` to `OPEN` for the failing provider.
2. **Execute Manual Emergency Brake**: If the automated breaker fails to trip, execute the administrative circuit trip command immediately:
```bash
curl -X POST "https://proxy.keycollective.org/admin/breaker/trip" \
  -H "Authorization: Bearer $ADMIN_MASTER_SECRET" \
  -d '{"provider": "anthropic", "reason": "Cascading upstream 529 outage"}'
```
3. **Engage Intelligent Cascade Fallback**: The `CascadeRouter` automatically diverts incoming client traffic to alternative model providers configured in the capability matrix (e.g., falling back from Claude 3.5 Sonnet to GPT-4o or Gemini 1.5 Pro).

---

## RUNBOOK-04: Malicious Tenant Overdraft & Sybil Resource Drain

- **Severity Classification**: SEV-1 (Financial / Security Incident)
- **Affected Subsystems**: Anti-Sybil Engine (`src/auth/sybil/engine.ts`), Tenant Quota Actor
- **Trigger Condition**: Aggregate communal debt increases by $>50,000,000\text{ µ\$}$ ($50 USD) within 5 minutes, or multiple tenants from a single IP subnet exhaust overdraft limits.

### Diagnostic Workflow
Identify top debtor accounts in D1:
```bash
pnpm wrangler d1 execute key-collective-db --command \
  "SELECT tenant_id, current_debt_microdollars, overdraft_ceiling_microdollars \
   FROM tenant_quotas ORDER BY current_debt_microdollars DESC LIMIT 10;"
```

### Remediation Protocol
1. **Suspend Offending Tenant Actors**: Immediately freeze the malicious tenant's Durable Object isolate:
```bash
curl -X POST "https://proxy.keycollective.org/admin/tenants/quarantine" \
  -H "Authorization: Bearer $ADMIN_MASTER_SECRET" \
  -d '{"tenantId": "attacker-org-id", "reason": "Excessive overdraft velocity"}'
```
2. **Invalidate Contributed Credentials**: Flag all API keys submitted by the offending tenant as `QUARANTINED` in `PoolCoordinatorDO` and revoke active communal leases.
3. **Push WAF Block Rules**: Blacklist the offending client IP addresses or autonomous system numbers (ASNs) at Cloudflare's edge firewall.

---

## RUNBOOK-05: Nonce Exhaustion & Master Key Rotation Protocol

- **Severity Classification**: SEV-2 (Security Maintenance)
- **Affected Subsystems**: Web Crypto Core (`src/crypto/encryption/keys.ts`)
- **Trigger Condition**: Tenant key version increments, or routine 90-day master key rollover required by compliance policies.

### Diagnostic Workflow
Verify current key version distribution across the active key catalog:
```bash
pnpm wrangler d1 execute key-collective-db --command \
  "SELECT key_version, count(*) FROM api_keys GROUP BY key_version;"
```

### Remediation Protocol
1. **Provision New Master Secret**: Inject the new encryption key into Cloudflare Workers Secrets:
```bash
pnpm wrangler secret put MASTER_ENCRYPTION_KEY_V2
```
2. **Dual-Key Read Support**: The crypto engine attempts decryption using `MASTER_ENCRYPTION_KEY_V2`; on failure, it falls back to `MASTER_ENCRYPTION_KEY_V1`.
3. **Background Re-Encryption Pipeline**: Deploy the migration cron to re-encrypt all stored records in D1 with fresh 12-byte nonces and update `key_version = 2`.

---

## 6. On-Call Escalation Matrix

| Tier Level | Role | Maximum Engagement SLA | Responsibilities |
|---|---|---|---|
| **Tier 1** | Primary On-Call SRE | 5 minutes (SEV-1) / 15 minutes (SEV-2) | Immediate triage, breaker trips, and runbook execution |
| **Tier 2** | Core Systems Engineer | 15 minutes (SEV-1) / 30 minutes (SEV-2) | Code patch, hotfix deployment, and D1 query analysis |
| **Tier 3** | Principal Architect | 30 minutes (SEV-1) | Major architectural overrides, provider executive escalation |

---

## 7. Self-Check Active Recall Quiz

1. **Question:** What is the risk of allowing edge workers to retry failing D1 database queries during an active SQLite database lock condition?
<details>
<summary>Click to reveal answer</summary>
Retrying against a locked SQLite database compounds thread contention, causes worker isolates to exceed their 30-second execution timeouts, and exhausts edge connection pools, converting a localized storage delay into a total proxy outage.
</details>

2. **Question:** How does the CascadeRouter protect downstream client applications when an upstream provider experiences a total regional blackout?
<details>
<summary>Click to reveal answer</summary>
When the CircuitBreakerDO trips to OPEN, the CascadeRouter intercepts the blocked request and dynamically re-routes it to a functional provider possessing matching model capabilities (such as tool calling and context size), preserving client availability.
</details>
