# Low-Level Design (LLD) - Pod Admin Backend

## 1. Overview
The Pod Admin Backend handles administrative endpoints for the Key Collective Pod Manager. It features an admin surveillance router with strict zero-knowledge denial for unauthorized access.

## 2. Components
### 2.1 Admin Router (`src/admin/admin_router.ts`)
Handles routing for administrative APIs.

#### Security Requirements
- **Role Verification:** All endpoints must verify that the requesting user's role is exactly `'admin'`.
- **Zero-Knowledge Denial:** If the user is not an admin, the router must return a `404 Not Found` rather than a `401 Unauthorized` or `403 Forbidden`. This obscures the existence of the admin endpoints from unauthorized actors.

#### Endpoints
- `GET /admin/api/tenants`
  - **Purpose:** List all tenants.
  - **Response Payload:** Contains velocities, tiers, quota limits, and spend for each tenant.
- `POST /admin/api/tenants/:id/role`
  - **Purpose:** Mutate the role or tier of a specific tenant (e.g., promote to 'ultra', demote).
  - **Parameters:** `id` (tenant ID).
  - **Request Body:** `{ "tier": "ultra" | "standard" | "...", "role": "admin" | "user" | "..." }`
- `POST /admin/api/tenants/:id/quarantine`
  - **Purpose:** Quarantine or unquarantine an abusive tenant.
  - **Parameters:** `id` (tenant ID).
  - **Request Body:** `{ "quarantined": true | false }`
- `GET /admin/api/pool/health`
  - **Purpose:** Monitor the health of the key pool and circuit breaker statuses.
  - **Response Payload:** Health metrics, error rates, circuit breaker states per tenant/pool.
- `POST /admin/api/pool/circuit-breaker/reset`
  - **Purpose:** Manual override to reset a tripped circuit breaker.
  - **Request Body:** `{ "target": "tenant_id" | "pool_id" }`

### 2.2 Unit Tests (`tests/admin/admin_router.test.ts`)
Comprehensive unit tests for the Admin Router.

#### Test Cases
- **Security:**
  - Verify `404 Not Found` is returned for all endpoints when a non-admin token or no token is provided.
- **Endpoint Tests:**
  - Mock tenant retrieval and test `GET /admin/api/tenants`.
  - Mock state mutation and test `POST /admin/api/tenants/:id/role`.
  - Mock state mutation and test `POST /admin/api/tenants/:id/quarantine`.
  - Mock health checks and test `GET /admin/api/pool/health`.
  - Mock circuit breaker reset and test `POST /admin/api/pool/circuit-breaker/reset`.
