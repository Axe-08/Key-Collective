# 🔄 Execution Sequence Flows: Key Collective (v4.0)

This document visualizes the mission-critical runtime execution lifecycles of Key Collective's edge architecture on Cloudflare Workers and Durable Objects.

---

## 1. Proxied LLM Inference Lifecycle

Traces an incoming client chat request from edge authentication, through quota validation, dynamic key dispatch, ephemeral decryption, upstream forwarding, SSE error sanitization, and non-blocking telemetry settlement.

```mermaid
sequenceDiagram
    autonumber
    actor Client as External LLM Consumer
    participant Gateway as Worker Gateway (src/worker/gateway)
    participant Auth as Auth Middleware (src/worker/auth)
    participant QuotaDO as TenantQuotaDO (src/quota/tenant)
    participant Router as CascadeRouter (src/router/cascade)
    participant CoordDO as PoolCoordinatorDO (src/durable_objects)
    participant KeyPoolDO as KeyPoolDO (src/durable_objects/key_pool)
    participant Crypto as HKDF/WebCrypto (src/crypto/encryption)
    participant Upstream as Upstream Provider (OpenAI/Anthropic)
    participant SSE as SSE Sanitizer & Transformer (src/proxy/sse)
    participant Analytics as Analytics Engine & D1 Ledger

    Client->>Gateway: POST /v1/chat/completions (Bearer sk-kc-..., payload)
    Gateway->>Auth: authenticateRequest(req)
    Auth->>Auth: Validate JWT / Bearer Token & Extract TenantId
    Auth-->>Gateway: AuthenticatedContext { tenantId, tier, role }

    Gateway->>QuotaDO: checkQuotaAndConsumeRPM(tenantId, estimatedTokens)
    alt Rate Limit or Quota Exceeded
        QuotaDO-->>Gateway: Reject 429 { error: "RPM_EXCEEDED" | "QUOTA_EXHAUSTED" }
        Gateway-->>Client: HTTP 429 Too Many Requests
    else Quota Approved
        QuotaDO-->>Gateway: Approved { remainingRpm, creditBalance }
    end

    Gateway->>Router: routeRequest(req, model, tenantId)
    Router->>CoordDO: requestKeyDispatch(model, tenantId)
    Note over CoordDO: Dynamic Priority Evaluation:<br/>1. Own Key (Tenant-owned)<br/>2. Debt Balancing Key<br/>3. Parasite Contributor Key<br/>4. Communal Hero Pool Key

    CoordDO->>KeyPoolDO: leaseKey(keyId, tenantId)
    KeyPoolDO-->>CoordDO: EncryptedKeyCiphertext { nonce, ciphertext, keyId }
    CoordDO-->>Router: DispatchedKeyMetadata

    Router->>Crypto: decryptKey(ciphertext, nonce, tenantMasterSecret)
    Crypto-->>Router: Plaintext Provider Key (in-memory, ephemeral)

    Router->>Upstream: Forward Request (Headers, Decrypted Key, Streaming Body)
    Upstream-->>SSE: Raw Chunked Stream (200 OK or Upstream Error)

    alt Upstream Error (status >= 400)
        SSE->>SSE: createErrorSanitizerTransform() (Strip provider tokens, sanitize error)
        SSE-->>Gateway: Sanitized JSON Error Envelope
        Gateway-->>Client: HTTP 502 / Upstream Error (Sanitized)
        Gateway->>KeyPoolDO: recordFailure(keyId, status)
    else Upstream Success (Streaming SSE)
        SSE->>SSE: Transform to standard SSE chunks + count usage tokens
        SSE-->>Gateway: Stream transformed chunks
        Gateway-->>Client: Live SSE Stream (chunk-by-chunk)
        
        Gateway-)Analytics: recordTelemetryEvent({ tenantId, keyId, tokens, latencyMs, microdollars })
        Gateway-)QuotaDO: settleDebtLedger({ tenantId, consumedMicrodollars })
    end
```

---

## 2. Live OAuth & Session Sync Flow

Traces a user authenticating via GitHub via the new `/api/auth/github/callback` endpoint:

```mermaid
sequenceDiagram
    autonumber
    actor User as Browser Client (ui/src)
    participant Gateway as Worker Gateway (src/worker/gateway)
    participant OAuth as OAuth Subsystem (src/worker/auth/oauth.ts)
    participant GitHub as GitHub OAuth API
    participant D1 as Cloudflare D1 (src/storage/repositories)

    User->>Gateway: GET /api/auth/github/callback?code=xxx
    Gateway->>OAuth: handleOAuthCallback(code)
    OAuth->>GitHub: POST /login/oauth/access_token
    GitHub-->>OAuth: access_token
    OAuth->>GitHub: GET /user
    GitHub-->>OAuth: UserProfile { email, id }
    OAuth->>D1: UPSERT INTO auth_tokens (session_token, tenant_id)
    D1-->>OAuth: Success
    OAuth-->>Gateway: Session Created
    Gateway-->>User: HTTP 302 Redirect to Console (with secure Cookie)
```

---

## 3. Key Contribution & HKDF Encryption Flow

Traces how a user donates an OpenAI/Anthropic API key to the communal pool:

```mermaid
sequenceDiagram
    autonumber
    actor Contributor as Contributing Developer
    participant UI as Svelte Workbench (ui/src/lib/workbench)
    participant Gateway as Worker Gateway (src/worker/gateway)
    participant Crypto as HKDF/WebCrypto (src/crypto/encryption)
    participant D1 as Cloudflare D1 (src/storage/repositories)
    participant CoordDO as PoolCoordinatorDO

    Contributor->>UI: Submit Provider Key (sk-ant-..., poolMode: "community")
    UI->>Gateway: POST /api/keys { provider, rawKey, poolMode }
    Gateway->>Gateway: Derive Per-Tenant Key via HKDF(tenantMasterSecret, tenantId)
    Gateway->>Crypto: AES-256-GCM Encrypt(rawKey, 12-byte random nonce)
    Crypto-->>Gateway: { ciphertext, nonce }
    Gateway->>D1: INSERT INTO keys (id, tenant_id, provider, ciphertext, nonce, status)
    D1-->>Gateway: Success (Key Persisted)
    Gateway->>CoordDO: registerContributedKey(keyId, tenantId, provider)
    CoordDO-->>Gateway: Key Registered & Capacity Credits Granted
    Gateway-->>UI: HTTP 201 Created { keyId, status: "active", capacityCredits }
```
