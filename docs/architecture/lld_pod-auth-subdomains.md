# Low Level Design: Pod Auth Subdomains

## 1. Overview
This pod handles subdomain host routing, two-phase authentication flows, and anti-sybil mechanisms for the Key Collective platform.

## 2. Architecture Details

### 2.1 Subdomain Host Routing (`src/worker/index.ts`)
The edge worker will inspect the `Host` header of incoming requests to route traffic:
- `api.key-col.axe08.tech`: Routes to the LLM proxy gateway hot path.
- `console.key-col.axe08.tech`: Serves the Developer Console SPA static assets.
- `admin.key-col.axe08.tech`: Routes to the Admin surveillance router. For non-admins, it will return a `404 Not Found` to ensure zero-knowledge denial.

### 2.2 Two-Phase Authentication Flow
To balance onboarding friction with abuse prevention, authentication is split into two phases:
- **Phase 1 (Initial Onboarding):** Email / Google OAuth. Users are placed in a sandboxed 'probationary' tier (2 RPM, 50 RPD, 50,000 µ$ budget cap).
- **Phase 2 (Verified Upgrade):** GitHub OAuth PKCE. Users are upgraded to 'builder' or 'max' tiers after passing the 5-layer sybil scoring.

### 2.3 5-Layer Anti-Sybil Score Check (`src/auth/sybil.ts`)
A comprehensive scoring mechanism evaluates users upon GitHub OAuth completion:
1. **Turnstile Bot Score:** Ensures the request originates from a human.
2. **IP Velocity:** Checks for multiple accounts originating from the same IP within a time window.
3. **Disposable Email Domain:** Rejects or penalizes known disposable/temporary email providers.
4. **GitHub Account Age:** Requires the linked GitHub account to be older than 30 days.
5. **GitHub Activity:** Requires >5 public repos or >20 contributions to prove the account is active and genuine.

### 2.4 Database Schema Migrations (`migrations/0003_v3_5_governance.sql`)
The `users` table will be updated with:
- `sybil_score` (integer)
- `auth_phase` (integer, e.g., 1 or 2)
- `role` (string/enum, e.g., 'probationary', 'builder', 'max', 'admin')

A new `audit_logs` table will be created to track authentication events and sybil score calculations.

### 2.5 Testing (`tests/auth/two_phase_auth.test.ts`)
Comprehensive unit and integration tests will cover:
- Subdomain routing logic and 404 zero-knowledge denial for admin routes.
- State transitions from Phase 1 to Phase 2.
- Mocked implementations of the 5-layer anti-sybil checks to verify edge cases.
