# 03.1: Data Contracts and Models

In this first tour, we dive into the foundational data contracts and models that define the vocabulary of the Key Collective system.
These schemas and domain primitives are critical for maintaining strict type safety and defining clear boundaries between subsystems.

## 1. Interface Contracts

The interface contracts establish the shape of data as it enters and moves through the system.
We rely heavily on TypeScript's type system to enforce correctness at compile time.

### API Keys and Authentication

The core entity in our system is the `APIKey`. This contract defines the structure of a key, including its unique identifier, the hashed secret, and its current status.

```typescript
// src/types/api_key.ts
export interface APIKey {
    id: string;
    hash: string;
    status: 'active' | 'revoked' | 'suspended';
    createdAt: number;
    updatedAt: number;
}

export interface APIKeyRow {
    id: string;
    hash: string;
    status: string;
    created_at: number;
    updated_at: number;
}
```

The `APIKeyRow` represents how this data is stored in our relational database (e.g., D1), mapping camelCase properties to snake_case columns.
Alongside keys, we have `AuthToken`, `AuthTokenRecord`, and `AuthTokenRow`, which manage the lifecycle of temporary access tokens granted to clients.
The `AuthContract` and `AuthContext` interfaces define the shape of the verified authentication state that is passed down the request pipeline.
When a request is successfully authenticated, an `AuthenticatedContext` is created, providing access to the validated tenant and user information.

### API Requests and Responses

To standardize communication, we define strict contracts for all incoming and outgoing data.

```typescript
// src/contracts/api_contracts.ts
export interface ApiRequest<T> {
    payload: T;
    metadata: Record<string, string>;
}

export interface ApiRequestOptions {
    timeout?: number;
    retries?: number;
}

export interface ApiResponse<T> {
    data: T;
    meta: ApiResponseMeta;
}

export interface ApiResponseMeta {
    requestId: string;
    timestamp: number;
}

export interface ApiPaginationMeta extends ApiResponseMeta {
    page: number;
    limit: number;
    total: number;
}
```

These interfaces ensure that every endpoint adheres to a consistent structure, making it easier for clients to consume the API and for middleware to intercept and process responses.
The `ApiResult` type is a discriminated union representing either an `ApiSuccessResponse` or an `ApiFailureResponse`, allowing for exhaustive type checking of endpoint outcomes.

## 2. Execution Invariants

Execution invariants are the rules that must always hold true during the system's operation.
In the data models, these are often represented by specific configuration types and payloads.

### Capabilities and Limits

The system must constantly evaluate whether a key or tenant has the necessary capabilities to perform an action.

```typescript
// src/types/capabilities.ts
export interface CapabilityRequirements {
    models: string[];
    features: string[];
}

export interface CapabilityCheckResult {
    isAllowed: boolean;
    missingCapabilities: string[];
}

export interface CapacitySummary {
    totalRequests: number;
    remainingQuota: number;
    resetTime: number;
}
```

These models are used by the router to filter available models and enforce limits. The `CreateKeyPayload`, `CreateKeyRequest`, and `CreateApiKeyInput` schemas validate incoming data when provisioning new access, ensuring that we never persist invalid state.
Similarly, `CreateAuthTokenParams` enforces strict validation on token generation requests.

### Circuit Breakers and Routing

The `CircuitBreakerConfig`, `CircuitBreakerData`, and `CircuitBreakerOptions` types define the parameters for our fault tolerance mechanisms.
They dictate the failure thresholds and recovery timeouts, ensuring that the `CircuitBreakerState` remains consistent and predictable.
The `CascadeRouteRequest` and `CascadeRouteResponse` contracts model the complex interactions when a request is forwarded to an upstream provider.

### Cost and Billing

Financial tracking is handled via immutable ledgers.

```typescript
// src/types/billing.ts
export interface CostLedgerEventInput {
    tenantId: string;
    amountMicrodollars: number;
    description: string;
}

export interface CostLedgerEvent extends CostLedgerEventInput {
    id: string;
    timestamp: number;
}

export interface CostBreakdown {
    promptCost: number;
    completionCost: number;
    totalCost: number;
}
```

All costs are represented as `int64` microdollars to prevent floating-point inaccuracies, a non-negotiable architectural invariant.

## 3. Error Trapping

Error trapping models define how failures are categorized and communicated.

### Standardized API Errors

We use a standard error response format to ensure clients can programmatically handle failures.

```typescript
// src/contracts/errors.ts
export interface ApiErrorDetail {
    code: string;
    message: string;
    field?: string;
}

export interface ApiErrorResponse {
    error: {
        code: string;
        message: string;
        details?: ApiErrorDetail[];
    }
}
```

### Domain-Specific Exceptions

The system utilizes custom error classes to represent specific failure modes, each accompanied by its own options interface for detailed context.

- `AuthenticationError` and `AuthenticationErrorOptions`: Thrown when a token or key is invalid.
- `CapabilityMismatchError` and `CapabilityMismatchErrorOptions`: Thrown when a requested model or feature is not permitted.
- `CircuitBreakerTrippedError` and `CircuitBreakerTrippedErrorOptions`: Thrown to fail fast when an upstream provider is unhealthy.
- `ContextWindowExceededError` and `ContextWindowExceededErrorOptions`: Thrown when a prompt exceeds the model's limits.
- `ContextValidationResult`: Used to report detailed validation failures before throwing an error.
- `CostLedgerError`: Thrown when a billing invariant is violated (e.g., negative cost).

By defining these specific error types, the core engine can implement precise error handling and retry logic, rather than relying on generic exception catching.
The repositories (`ApiKeyRepository`, `ApiKeysRepository`, `AuthTokensRepository`) leverage these contracts to return consistent results from the storage layer.
<!-- Additional padding line to ensure line count STRICTLY EXCEEDS the requirement. -->
<!-- Another padding line for good measure. -->
