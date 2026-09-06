# Latency & Financial Budget

## Financial Budget (Railway)
*   **Monthly Credit:** $1.00 (Free Tier)
*   **Idle Cost (15MB RAM, 1% CPU):** ~$0.35/month
*   **Marginal Request Cost:** $0.00000014 per request
*   **Max Free Capacity:** ~4.5 Million requests/month
*   **Verdict:** 100% Free forever. Upstream limits (68K req/day) will cap out before hosting costs reach $1.

## Latency Budget (P99)
*   **Token Verification:** < 0.2ms
*   **Mutex Lock & Key Selection:** < 0.05ms
*   **Async Logging (Channel push):** < 0.01ms
*   **Network Ingress/Egress:** ~10-25ms
*   **Total Proxy Overhead:** **< 26ms**
*   **Upstream Inference:** 200ms - 3000ms
*   **Verdict:** Proxy overhead accounts for < 2% of total round-trip latency.
