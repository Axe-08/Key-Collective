# Telemetry & Observability Spec

## Request Logging (SQLite)
Every request generates a `RequestLog` record.
- **Flushing:** Batched via goroutine every 5 seconds.
- **Retention:** Background cron deletes records older than 7 days.

## Health Dashboard Metrics
1. `RPM Utilization`: `sum(requests_this_minute) / sum(rpm_limit)`
2. `Daily Quota Utilization`: `sum(requests_today) / sum(rpd_limit)`
3. `Average Latency by Key`: Continuously decaying average of last 100 requests.

## Trace Headers
Key Collective injects debugging headers into the response back to the client:
- `X-KC-Key-Prefix`: First 6 chars of the key used.
- `X-KC-Provider`: `gemini` or `groq`.
- `X-KC-Retries`: Number of failover hops taken.
