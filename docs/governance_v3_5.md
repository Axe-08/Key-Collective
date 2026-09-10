# Multi-Project Governance & Authorization (v3.5)
## Key Collective: 7-Tier RBAC & Spend Quotas

**Author:** Product Engineer & Systems Architect  
**Status:** Approved by User  

---

## 1. 7-Tier Role-Based Access Control (RBAC)

| Tier Level | Role Identifier | Scope & Capabilities |
|:---:|---|---|
| **Tier 7** | `system_admin` | Global platform administration, emergency freeze, all tenants. |
| **Tier 6** | `tenant_admin` | Root tenant administration, D1 account migrations, project creation. |
| **Tier 5** | `project_manager`| Full control within a project; key creation, revocation, budget cap adjustments. |
| **Tier 4** | `key_creator` | Provisioning and rotating project-scoped virtual keys (`kc_proj_...`). |
| **Tier 3** | `telemetry_viewer`| Read-only access to proxy logs, latency histograms, and spend ledgers. |
| **Tier 2** | `proxy_consumer` | Standard downstream client; execute `/v1/chat/completions` using Bearer keys. |
| **Tier 1** | `demo_sandbox` | Ephemeral guest session; 15-minute isolated sandbox with 15 RPM cap. |

## 2. Fixed-Point Microdollar Quota Accounting
- **Conversion:** $1.00 USD = 1,000,000 µ$.
- **Storage:** Stored exclusively as 64-bit integers (`int64`) across Durable Objects transactional storage and D1 SQL.
- **Rollups:** Asynchronous non-blocking rollup via Cloudflare Workers `ctx.waitUntil()`. Zero proxy hot-path latency blocking.
