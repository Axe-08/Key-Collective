# Threat Model — Key Collective v3.5 (STRIDE & Anti-Sybil Defense)

> **Document Status:** Verified  
> **System:** Key Collective v3.5  
> **Methodology:** STRIDE + Zero-Trust Edge Threat Modeling  

---

## 1. Threat Surface Inventory

| Asset | Criticality | Storage / Location | Primary Threat Vector |
| :--- | :--- | :--- | :--- |
| **AES-256-GCM Encrypted Provider Keys** | Critical | D1 SQLite (Encrypted) + DO Memory (Decrypted) | Exfiltration, memory inspection, unauthorized proxy routing |
| **Shared Free-Tier LLM Quotas** | High | Upstream Provider Endpoints (Gemini / Groq) | Sybil botnet quota farming, 429 exhaustion attacks |
| **Admin Surveillance & Control Panel** | Critical | `admin.key-col.axe08.tech` | Credential stuffing, privilege escalation, unauthenticated access |
| **Tenancy Isolation Boundary** | Critical | Cloudflare Durable Objects (`idFromName(tenantId)`) | Cross-tenant memory leaks, noisy neighbor starvation |

---

## 2. STRIDE Threat Analysis & Mitigations

### 2.1 Spoofing Identity
* **Threat:** Malicious actor creates 100 fake Google accounts to harvest free LLM proxy quotas.
* **Mitigation:** Two-phase elevation gate. Initial Google accounts are locked into the `probationary` sandbox (2 RPM, 50 RPD, 50,000 µ$ budget cap). Elevating to developer quotas requires linking an aged ($\ge 60$d), active ($\ge 15$ commits) GitHub account. D1 enforces `UNIQUE(github_user_id)`.

### 2.2 Tampering with Data
* **Threat:** Client sends `{"tier": "ultra"}` or `{"tier": "admin"}` in user update or registration requests.
* **Mitigation:** Strict schema validation in `AuthMiddleware`. `ultra` and `admin` are completely stripped from public types. Any client payload containing internal tier values is rejected with `HTTP 400 Bad Request`.

### 2.3 Repudiation
* **Threat:** Rogue administrator downgrades or quarantines a high-volume tenant without trace evidence.
* **Mitigation:** Immutable `admin_audit_logs` table in D1 recording `admin_email`, `action`, `target_tenant_id`, `details_json`, `ip_address`, and `created_at`.

### 2.4 Information Disclosure
* **Threat:** External attacker discovers `admin.key-col.axe08.tech` and enumerates endpoints or extracts database schemas from client source maps.
* **Mitigation:** Zero-knowledge edge denial. Non-admin requests receive `HTTP 404 Not Found` (never 401/403). Admin JavaScript chunks are isolated and edge-gated by the Worker.

### 2.5 Denial of Service
* **Threat:** Upstream provider experiences a sudden 429 rate limit burst or 500 internal server outage.
* **Mitigation:** DO-managed `CircuitBreaker` with 60s quarantine and automatic sub-4ms cascade failover to secondary providers (e.g. Gemini $\rightarrow$ Groq $\rightarrow$ Cerebras).

### 2.6 Elevation of Privilege
* **Threat:** Tenant creates a project with `maxRpmSubCap = 1000` to exceed their account ceiling.
* **Mitigation:** Deterministic clamping inside `KeyPoolDO`: `effectiveRpm = min(project.subCap, tierLimits[user.tier].rpmLimit)`. The Durable Object enforces the account ceiling regardless of project configuration.
