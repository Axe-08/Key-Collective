# Unit 1: Data Contracts, Schemas & Domain Primitives

## Overview & Pedagogical Scope
In high-throughput, edge-native distributed architectures, the bedrock of reliability is the contract layer. Key Collective v2 establishes an immutable contract foundation that eliminates floating-point drift, enforces strict type boundaries across Cloudflare Workers and Durable Objects, and guarantees that sensitive credentials never exist in plaintext beyond ephemeral cryptographic boundaries.

This unit dissects the type definitions, contract interfaces, financial models, and domain error hierarchies that govern all system communication.

---

## 1. Frozen Interface Contracts
All inter-pod boundaries are governed by four frozen interfaces: `AuthContract`, `KeyPoolContract`, `RouterContract`, and `TelemetryContract`.

```typescript
// src/contracts/index.ts
export interface AuthContract {
  authenticate(request: Request): Promise<AuthContext>;
}

export interface KeyPoolContract {
  getKey(req: RouteRequest): Promise<RouterDecision>;
  recordUsage(decision: RouterDecision, usage: TokenUsage): Promise<void>;
  recordResult(decision: RouterDecision, success: boolean, statusCode: number): Promise<void>;
}

export interface RouterContract {
  resolveRoute(req: CascadeRouteRequest): Promise<CascadeRouteResponse>;
}

export interface TelemetryContract {
  emit(event: TelemetryEvent): void;
}
```

Standardized API envelope payloads rely on `ApiResponse`, `ApiRequest`, `ApiSuccessResponse`, `ApiFailureResponse`, `ApiErrorResponse`, `ApiErrorDetail`, `ApiResponseMeta`, `ApiPaginationMeta`, `ApiResult`, `PaginatedApiResponse`, `ApiRequestOptions`, `HealthResponse`, `MessageResponse`, `TestKeyResponse`, and `ToastMessage`.

---

## 2. Authentication & Tenant Data Models
The tenancy and authentication layer defines the caller identity and financial quotas:

```typescript
// src/types/api.ts & src/contracts/auth.ts
export interface AuthToken {
  id: string;
  tokenHash: string;
  tenantId: string;
  budgetMicrodollars: bigint;
  spentMicrodollars: bigint;
  rpmLimit: number;
  allowedProviders: string[];
  isActive: boolean;
  createdAt: string;
}

export interface AuthContext {
  token: AuthToken;
  tenantId: string;
  remainingMicrodollars: bigint;
}
```

Additional tenant configuration and persistence models include:
- `AuthTokenRecord` and `AuthTokenRow`: Represent physical SQLite rows in Cloudflare D1.
- `AuthenticatedContext`: The fully verified security context attached to downstream requests.
- `TenantConfig` and `TenantBudgetConfig`: Enforce per-tenant spend caps and provider white-lists.
- `TenantSpendSummary`: Aggregated usage and budget headroom metrics.

---

## 3. Cryptographic & API Key Domain Primitives
Every upstream provider key is managed through `APIKey` and `APIKeyRow`.

```typescript
// src/types/models.ts
export interface APIKey {
  id: string;
  tenantId: string;
  provider: KnownModelProvider;
  label: string;
  encryptedKey: Uint8Array;
  nonce: Uint8Array;
  keyPrefix: string;
  keySuffix: string;
  priority: number;
  rpmLimit: number;
  rpdLimit: number;
  status: KeyStatus;
}
```

Key lifecycle and selection primitives include `KeyInput`, `KeyResponse`, `KeyMetrics`, `KeyStatus`, `KeyTriageItem`, `KeyTriageResult`, `SelectableKey`, and `MaskedKeyParts`.

Cryptographic payloads and buffers utilize strict types: `EncryptedKey`, `EncryptedPayload`, `EncryptedData`, `PlaintextInput`, `CiphertextInput`, and `HashInput`.

---

## 4. Model Registry, Pricing & Capability Schemas
Models and upstream capabilities are cataloged via:
- `ModelDef`: Context length, max output tokens, tool/vision/schema flags.
- `ModelPricing`: Input, output, and cache-read costs denominated strictly in microdollars.
- `ModelCapabilities`: Bitmasks and boolean capability flags.
- `ModelAlias`: Logical alias resolution mappings (e.g. `smart-fast`).
- `ModelProvider`: Upstream provider identifier.
- `KnownModelAlias` and `KnownModelProvider`: Strongly typed enum unions for supported LLMs.
- `ModelFilterCriteria`, `ModelFilterOptions`, and `ModelSortStrategy`: Sieve rules for candidate selection.

---

## 5. Domain Error Hierarchy
Key Collective enforces an exhaustive error tree extending `Error`:

```typescript
// src/errors/index.ts
export interface DomainErrorOptions {
  cause?: unknown;
  code?: string;
  statusCode?: number;
}
export interface DomainErrorJson {
  error: string;
  code: string;
  statusCode: number;
}
```

The error catalog comprises:
- **Authentication & Tenancy:** `AuthenticationError`, `AuthenticationErrorOptions`, `TenantIsolationError`, `TenantIsolationErrorOptions`, `TenantIsolationViolationError`.
- **Key & Quota Management:** `InvalidKeyError`, `InvalidKeyErrorOptions`, `KeyNotFoundError`, `KeyNotFoundErrorOptions`, `KeyExhaustedError`, `KeyExhaustedErrorOptions`, `QuotaExceededError`, `QuotaExceededErrorOptions`, `RateLimitExceededError`, `RateLimitExceededErrorOptions`.
- **Fault Tolerance & Circuit Breaking:** `CircuitBreakerTrippedError`, `CircuitBreakerTrippedErrorOptions`.
- **Model & Routing:** `ContextWindowExceededError`, `ContextWindowExceededErrorOptions`, `CapabilityMismatchError`, `CapabilityMismatchErrorOptions`, `UnknownModelAliasError`, `UnknownModelAliasErrorOptions`, `ModelNotFoundError`, `ModelNotFoundErrorOptions`, `NoAvailableProviderError`, `NoAvailableProviderErrorOptions`, `FallbackExhaustedError`, `FallbackExhaustedErrorOptions`, `ProviderRoutingError`, `ProviderRoutingErrorOptions`, `ProviderTimeoutError`, `ProviderTimeoutErrorOptions`, `RouterError`.
- **Telemetry & Financial:** `CostLedgerError`, `InvalidCostLedgerEventError`, `TelemetryEmissionError`, `TelemetryEmissionErrorOptions`, `InvalidTelemetryEventError`, `InvalidTelemetryEventErrorOptions`.
- **Cryptography:** `EncryptionError`, `EncryptionErrorOptions`, `DecryptionError`, `DecryptionErrorOptions`.

### Complexity & Memory Allocation Profile
| Entity Group | Structural Memory Footprint | Runtime Mutation | Big-O Access |
|---|---|---|---|
| Contracts & Schemas | $\mathcal{O}(1)$ allocation | Immutable | $\mathcal{O}(1)$ member access |
| Domain Error Classes | $\mathcal{O}(1)$ allocation | Prototype chain | $\mathcal{O}(1)$ instantiation |
| Microdollar Pricing | 64-bit BigInt primitives | Pure value types | $\mathcal{O}(1)$ arithmetic |
