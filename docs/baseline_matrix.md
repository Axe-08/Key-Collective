# Competitive Baseline Matrix

| Criteria | Key Collective v2 | LiteLLM Proxy | OpenRouter | Portkey.ai | Key Collective v1 |
| --- | --- | --- | --- | --- | --- |
| **Cost at 10M req/mo** | <$15 | High (VPS/Cloud) | N/A (per token) | High (SaaS) | Med (Railway) |
| **Global edge** | Yes (Cloudflare) | No (by default) | Yes | Yes | No (Single region) |
| **Multi-tenant isolation**| Yes (DO per tenant) | Yes | N/A | Yes | No |
| **Smart routing** | Yes | Yes | Yes | Yes | Basic |
| **Open source** | Yes | Yes | No | Yes | Yes |
| **Cold start latency** | ~0ms (Isolates) | Medium (Docker) | Low | Low | Low (Keepalive) |
| **Self-hostable** | Yes (Cloudflare) | Yes | No | Yes | Yes |
| **Bring your own keys** | Yes | Yes | No | Yes | Yes |
