# Low-Level Design: pod-auth-sybil

## 1. Overview
The `pod-auth-sybil` module manages GitHub OAuth flow with PKCE (RFC 7636), implements 5-layer anti-sybil protection for user registration, and manages the ephemeral `demo_do` (Demo Durable Object) as specified in `docs/system_design_v3.md`.

## 2. Scope
- **OAuth Integration (`tests/auth/oauth.test.ts`)**: Ensure secure GitHub OAuth flow, including RFC 7636 PKCE challenge string calculation and exchanging code for access token.
- **Anti-Sybil Protections (`tests/auth/sybil.test.ts`)**: 5-layer anti-sybil checks to prevent bot registrations and abuse.
- **Demo Durable Object (`src/auth/demo_do.ts` & `tests/auth/demo_do.test.ts`)**: The state machine and DO alarm engine for the ephemeral Demo Tier as per v3 design.

## 3. Architecture Invariants
- **TypeScript Strict Mode**: Zero `any` usage.
- **Microdollar Accounting**: All metrics tracked in bigint microdollars.
- **Ephemeral State**: DemoDO operates on a 15-minute token rotation alarm.
- **Per-Tenant DO Isolation**: State machines securely isolated.

## 4. Components

### 4.1. OAuth Flow
- Handles PKCE (Proof Key for Code Exchange) per RFC 7636.
- `exchangeCodeForToken` handles access token generation and validation.

### 4.2. Sybil Defense (5-Layer)
- Validates properties like IP history, GitHub account age, Cloudflare Turnstile siteverify, etc.

### 4.3. Demo Durable Object (`DemoDO`)
- Singleton Actor with a 15-minute Alarm.
- Generates and rotates tokens like `kc_demo_{timestamp}_{random}`.
- Tracks IP sliding windows for rate limiting.
- Purges stale IPs after 1 hour.

## 5. Security Considerations
- OAuth flow requires correct base64url encoded SHA-256 PKCE validation to prevent authorization code interception.
- DemoDO uses `crypto.getRandomValues` for secure token generation.
- In-memory data is isolated within the Durable Object instance.
