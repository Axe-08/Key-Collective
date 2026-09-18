# Low-Level Design: Pod Routing Governance

## 1. Subdomain Host Routing at Edge Isolate
**Files**: `src/worker/router/core/dispatcher.ts`, `src/worker/gateway/subdomain.ts`

### Motivation
The Key Collective platform utilizes dedicated subdomains (`api.*`, `console.*`, `admin.*`, apex) to physically separate traffic streams (proxy hot path vs SPA vs admin surveillance). This separation must be aggressively enforced at the edge isolate.

### Design
Integrate the `resolveHostRoute` utility from `src/worker/gateway/subdomain.ts` early in the lifecycle of `dispatchRoute` in `dispatcher.ts`.
- **Apex domain**: Immediately return an HTTP 301 Redirect to `https://console.key-col.axe08.tech`.
- **Admin domain**: Intercept requests to `admin.*`. Validate the request's JWT/Token tier. If the user is unauthenticated or `tier !== 'admin'`, return a generic `404 Not Found` (Security by Obscurity) instead of a 401/403.
- **Console domain**: Bypass API validations and safely route to the `ASSETS` binding for SPA static delivery.
- **API domain**: Continue with standard telemetry, authentication, and `ChatHandler` / `KeyPoolDO` logic.

## 2. Phase 2 Anti-Sybil Elevation Gate (GitHub OAuth)
**Files**: `src/worker/router/dashboard/auth_routes.ts`, `src/contracts/v3_5_types.ts`

### Motivation
Probationary tenants are allowed to escalate their permissions (`tier = 'builder'` or `tier = 'max'`) by proving humanity through GitHub OAuth. We must enforce strict Anti-Sybil invariants before promoting the user.

### Design
In `handleOAuthGithubCallback` in `auth_routes.ts`:
1. **Account Age Validation**: Fetch `created_at` from the GitHub `/user` response. Calculate account age in days. Reject if `< 60` days.
2. **Activity Validation**: Query the GitHub `/users/{username}/events/public` or `/search/commits?q=author:{username}` API to confirm >= 15 public commits in the past 12 months. 
3. **Sybil Constraint Verification**: Apply the D1 `UNIQUE(github_user_id)` constraint logic to prevent one user from spinning up multiple Key Collective accounts.
4. **Promotion Assignment**: Map these checks to the `SybilProofResult` structure. If passed, assign `tier = 'builder'` or `tier = 'max'`. If failed, enforce `tier = 'probationary'`.

## 3. Hidden Tiers & Security by Obscurity
**Files**: `src/worker/router/dashboard/auth_routes.ts`, `src/types/config.ts`

### Motivation
Internal governance tiers (`ultra` and `admin`) have unrestricted capabilities. Their existence must be completely hidden from public API consumers and the SPA bundle to prevent targeted attacks.

### Design
1. In `handleSyncSession` and equivalent API endpoints, strip out internal tiers from public payloads. If the database returns `tier: 'ultra'` or `tier: 'admin'`, map it to `max` in the frontend response body (while maintaining the actual tier in the backend's secure token/JWT).
2. Establish strict TypeScript type boundaries distinguishing `PublicTier` from `InternalTier` matching the contracts.
