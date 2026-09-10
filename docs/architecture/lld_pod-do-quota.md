# Low-Level Design (LLD): pod-do-quota

## 1. Context and Scope
This document outlines the design for the `pod-do-quota` pod, handling strict quota and rate limiting within Key Collective. The focus is to guarantee Per-Tenant Compute Isolation using Cloudflare Durable Objects (`TenantQuotaDO`) as per the architectural invariants.

### Affected Files
- **Contracts**: `src/contracts/v3_types.ts`
- **Source**: 
  - `src/quota/tenant_do.ts` (Durable Object for Tenant limits)
  - `src/quota/limits.ts` (Pure math and lookup functions for limits)

## 2. Invariants
- **No Plaintext Keys / Floating-Point Math**: All financial tracking uses int64/bigint microdollars.
- **Tenant Isolation**: DO IDs are strictly bound to `tenantId`.
- **Hot State Reliability**: In-memory rate limits (RPM, RPD) sync to `this.ctx.storage` to survive DO evictions gracefully.

## 3. Component Design

### 3.1 `src/quota/limits.ts`
Provides stateless pure functions evaluating limit boundaries based on `v3_types.ts`.
- `getTierLimits(tier: UserTier): TierLimits`: Simple O(1) lookup against `TIER_LIMITS_MAP`.
- `calculateProjectQuota(tenantTier: UserTier, projectMaxSubCap?: number | null): number`: Math helper verifying sub-caps never exceed tenant's root limit. Returns resolved RPM.

### 3.2 `src/quota/tenant_do.ts`
The Durable Object (`TenantQuotaDO`) mapping 1:1 with `UserAccount.id`.
- **State**: In-memory Map tracking RPM per project ID, and global Tenant RPD.
- **Storage**: `this.ctx.storage.put('usage_data', ...)` 
- **Core Operations**:
  - `fetch(request: Request)`: Handles internal bindings for quota checking.
  - `consumeQuota(projectId: string, tier: UserTier, costMicrodollars: number): { allowed: boolean, reason?: string }`
- **Alarm / Lifecycle**: Implements `alarm()` handler to reset daily quota or periodically flush memory to disk to avoid write-blocking the proxy fast-path.
