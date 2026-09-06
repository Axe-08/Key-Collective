# Failure Mode & Effects Analysis (FMEA)

| Failure Mode | Detection | Automated Mitigation | Manual Runbook |
|:-------------|:----------|:---------------------|:---------------|
| **Key hits 429 (Rate Limit)** | Proxy receives HTTP 429 | `RateLimited` status, 60s cooldown, transparent retry with next key. | Check if quota requires upgrade. |
| **All keys hit 429** | Key pool selection yields 0 | Return HTTP 503 to client instantly. | Add more keys or reduce application load. |
| **SQLite write lock/corruption** | Goroutine batch flush fails | Drop log batch, keep proxying traffic (Availability > Observability). | Restore DB from backup, check volume I/O. |
| **Railway Container Restart** | In-memory minute counters reset | Minute windows start fresh. Potential brief burst of 429s. | Self-healing via circuit breaker mechanism. |
