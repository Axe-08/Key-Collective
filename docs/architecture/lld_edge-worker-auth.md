# Low-Level Design: edge-worker-auth

## 1. Overview
The `edge-worker-auth` module is a Cloudflare Worker responsible for authenticating inbound requests, resolving tenant identities, and routing requests to the appropriate Durable Object for key pooling and LLM routing. It implements the strict invariants of the Key Collective architecture.

## 2. Scope (`src/worker/**`)
- **Authentication Middleware (`src/worker/auth.ts`)**: Implements `AuthContract`. Validates bearer tokens against a D1 database.
- **Worker Entrypoint (`src/worker/index.ts`)**: Handles the `fetch` event, extracts the `tenantId` from the `AuthContext`, and forwards the request to the `KEY_POOL` Durable Object.
- **Telemetry Integration (`src/worker/telemetry.ts`)**: Non-blocking telemetry emission to Workers Analytics Engine.

## 3. Architecture Invariants (Key Collective)
- **TypeScript Strict Mode**: Zero `any` usage.
- **Per-Tenant DO Isolation**: Routing relies on `env.KEY_POOL.idFromName(tenantId)` to strictly isolate compute and memory per tenant.
- **Non-Blocking Telemetry**: Telemetry events must not block the proxy hot path and must use Analytics Engine bindings.
- **Fixed-Point Microdollars**: Financial metrics are tracked using `bigint` microdollars.
- **No Plaintext Keys/Tokens**: Tokens and API keys are strictly hashed or AES-256-GCM encrypted.

## 4. Components

### 4.1. `WorkerEnv` Interface
Defines the Cloudflare environment bindings.
```typescript
export interface WorkerEnv {
  D1_DB: D1Database;
  KEY_POOL: DurableObjectNamespace;
  ANALYTICS: AnalyticsEngineDataset;
}
```

### 4.2. `TokenVerifier` (Implements `AuthContract`)
Verifies Bearer tokens using SHA-256 hashing to avoid plaintext token storage.
- **Input**: Bearer token string.
- **Process**: Hash token, query D1 for `AuthToken` record. Verify expiration.
- **Output**: `AuthContext` (tenantId, isAuthenticated).

### 4.3. Worker Fetch Handler (`index.ts`)
- Extracts Authorization header.
- Calls `TokenVerifier`.
- If unauthorized, returns 401 Unauthorized.
- If authorized, invokes `env.KEY_POOL.idFromName(authContext.tenantId)`.
- Forwards the `Request` to the Durable Object stub: `stub.fetch(req)`.
- Emits telemetry asynchronously via `ctx.waitUntil()`.

## 5. Data Flow
1. Client -> Worker: HTTP Request with Bearer Token.
2. Worker -> D1: Token Verification (hashed lookup).
3. Worker -> KEY_POOL (Durable Object): Proxy Request `stub.fetch(req)`.
4. KEY_POOL -> Router -> External LLM Provider.
5. Worker -> Analytics Engine: Non-blocking telemetry emission.

## 6. Security Considerations
- Tokens are hashed before lookup to prevent timing attacks and plaintext leakage.
- Strict isolation via Tenant ID ensures no cross-tenant key access or memory leakage.
