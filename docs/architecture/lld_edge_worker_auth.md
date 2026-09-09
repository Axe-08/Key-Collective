# Low Level Design: Edge Worker Auth

## Overview
The Edge Worker Auth component acts as the primary ingress point and API Gateway for the Key Collective. It handles OpenAI-compatible routing, authentication via bearer tokens, budget checking, rate limiting, and telemetry emission.

## Components

### 1. Main Worker Export (`src/worker/index.ts`)
- **Responsibility**: The primary Cloudflare Worker entrypoint.
- **Routes**:
  - `GET /health`: Basic liveness probe.
  - `GET /v1/models`: List available models.
  - `POST /v1/chat/completions`: Route for OpenAI-compatible chat completions.
- **Workflow**: Intercepts requests, delegates to `AuthMiddleware` for authentication and budget checks, then routes to `RouterHandler` if successful.

### 2. AuthMiddleware (`src/worker/auth_middleware.ts`)
- **Responsibility**: Token validation, rate limiting, and budget enforcement.
- **Mechanism**:
  - Look up Bearer token via SHA-256 hash in D1.
  - Use `crypto.subtle.timingSafeEqual` to prevent timing attacks.
  - Check token-level RPM (Requests Per Minute) limits.
  - Gate on budget exhaustion (Return HTTP 429 if exhausted).
  - Target latency overhead: <2ms.

### 3. RouterHandler (`src/worker/router_handler.ts`)
- **Responsibility**: Route authenticated requests to the appropriate Durable Object (DO).
- **Mechanism**:
  - Handles `/v1/chat/completions`.
  - Determines tenant ID from the validated token.
  - Routes request to tenant-specific DO: `env.KEY_POOL.idFromName(tenantId)`.
  - Handles both streaming and non-streaming response modes, piping the DO response back to the client.

### 4. TelemetryEmitter (`src/worker/telemetry_emitter.ts`)
- **Responsibility**: Collect and emit telemetry data without blocking the request hot path.
- **Mechanism**:
  - Enqueues telemetry events to Cloudflare Workers Analytics Engine.
  - Uses `ctx.waitUntil()` to ensure delivery without increasing response latency.

### 5. Root Export (`src/index.ts`)
- **Responsibility**: Re-export the main worker entrypoint and DO classes for Cloudflare's build system.

## Testing Strategy
- **Unit Tests (`test/unit/worker/`)**: Mock D1, DO stubs, and Analytics Engine to test `AuthMiddleware`, `RouterHandler`, and `TelemetryEmitter` in isolation.
- **Integration Tests (`test/integration/worker/`)**: Use Vitest with Miniflare to run end-to-end flows against local D1 and DO instances, ensuring proper routing, authentication, and HTTP response handling.
