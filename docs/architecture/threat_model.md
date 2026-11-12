# Threat Model: Key Collective v4.0

**Date:** 2026-09-14  
**Methodology:** STRIDE + Attack Tree + FMEA  
**Classification:** Internal — Engineering Confidential  

---

## 1. STRIDE Analysis

| Component | Spoofing | Tampering | Repudiation | Info Disclosure | DoS | Elevation of Privilege |
|---|---|---|---|---|---|---|
| **API Proxy Worker** | Turnstile bypass → fake developer identity | Request payload injection mid-stream | No audit trail for demo mode requests | Downstream error pass-through (V14) | Volumetric flood → DO exhaustion | Tenant isolation bypass via hash collision |
| **PoolCoordinatorDO** | Node identity spoof (impossible at CF DO level) | State injection via malformed admin request | N/A | Cross-tenant telemetry correlation | Memory exhaustion via massive key registry | Admin state override via JWT forgery |
| **D1 Database** | N/A | Debt ledger tampering via direct D1 API | Key origin denial | D1 snapshot leak if credentials exposed | IOPS exhaustion | N/A — CF IAM controls |
| **Key Submission API** | Stolen key upload + fake K1/K2 | Project hash manipulation | Submission denial (no K1 signed) | Hash collision in in-memory takedown set | Forced-error probe flood (DoS ingestion) | HKDF derivation bypass |
| **Takedown Portal** | IP spoofing via proxy | Hash fabrication | N/A | Timing oracle → enumerate valid keys (V19) | Rate limit bypass → 5 req/IP/hr | N/A |

---

## 2. Attack Trees: Top 5 Highest-Risk Vectors

### Vector 17: Anti-Midnight Migration
```
Goal: Game daily quota by toggling pool at 23:59 UTC
├── Path A: Automate API call precisely at midnight
│   └── Mitigation: 23:30-00:30 UTC freeze window (FR-22)
└── Path B: Exploit clock skew between Edge Worker and DO
    └── Mitigation: Inject timestamp from single CF edge origin; DO trusts only this
```

### Vector 14: Downstream Error Pass-Through
```
Goal: Extract upstream provider metadata (GCP project, billing account)
├── Path A: Trigger obscure provider error format not caught by normalizer regex
│   └── Mitigation: Catch-all error envelope; only allow known error shapes through
└── Path B: Force model-not-found error containing project path
    └── Mitigation: Forced-Error Probe pre-strips this on ingestion; not in hot path
```

### Vector 19: Takedown Timing Oracle
```
Goal: Enumerate valid keys via response timing side-channel
├── Path A: Measure response time variation (DB hit vs miss)
│   └── Mitigation: 200ms constant-time response regardless of DB result
└── Path B: Induce GC pauses or CPU pressure to vary timing
    └── Mitigation: Response timer starts before DB query; artificial delay fills remainder
```

### Community Pool Free-Rider
```
Goal: Consume CU from pool without contributing healthy keys
├── Path A: Submit rate-limited/disabled key; route communal traffic before detection
│   └── Mitigation: 24h observation buffer + Forced-Error Probe at ingestion
└── Path B: Rotate key every 30 minutes to restart observation window indefinitely
    └── Mitigation: GCP project hash tombstone (14-day ban on same project hash)
```

### Quota Jail Bypass via Key Rotation Timing
```
Goal: Reset debt ledger by cycling keys at threshold boundary
├── Path A: Rotate key exactly when debt > 1.0x to orphan debt state
│   └── Mitigation: Debt is tenant-level, not key-level; rotation doesn't reset debt
└── Path B: Delete account and re-register with new GitHub account
    └── Mitigation: GitHub account age scoring + IP velocity limits
```

---

## 3. Mitigations vs. Gaps

| Threat | Existing Mitigation | Identified Gap | Residual Risk |
|---|---|---|---|
| V17: Anti-Midnight Migration | 23:30-00:30 UTC freeze | Clock skew between DOs could shrink window by a few seconds | **Medium** |
| V14: Downstream Error Leakage | Error normalizer (FR-10) + catch-all envelope | New provider error formats may bypass static regex | **High** — requires ongoing regex updates |
| V19: Takedown Timing Oracle | 200ms constant-time response (FR-11) | Worker CPU/GC pauses may add ±5ms variance | **Medium** — acceptable per OWASP timing guidelines |
| HKDF Derivation | Per-tenant HKDF | Master key rotation/revocation strategy undefined for v4.0 | **Low** — document rotation procedure |
| Free-Rider Detection | 24h observation + hash probe + hero/parasite classification | Parasite detection relies on accurate upstream 429 parsing; new error formats slip through | **High** — must maintain upstream error format database |
| Anomalous Spiker | 35% pool share cap per 5-min window | DO eviction resets 5-min counter; attacker can force eviction | **Medium** — minimum 10-min DO uptime via alarm |
| Sybil Attack | 5-layer anti-sybil + GitHub age scoring | GitHub account farming has become cheaper ($1-2 per aged account) | **Medium** — requires ongoing scoring tuning |
