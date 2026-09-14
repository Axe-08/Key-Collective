# Low-Level Design (LLD): pod-ui-v4 (Key Collective v4.0 Commons - Phase A)

## 1. Introduction
This LLD covers Phase A of the Key Collective v4.0 Commons UI upgrade, focusing on Svelte 5 Runes integration, strict TypeScript conformance, and UI components alignment with v4.0 API contracts (D1 migrations 0005-0007).

## 2. Invariants
- **Runtime & Framework**: Cloudflare Workers + Svelte 5 (Runes mode only: `$state`, `$derived`, `$effect`, `$props`).
- **Typing**: Strict TypeScript (`no_any: true`).
- **Dependencies**: No new API endpoints required in Phase A; existing ones gracefully fallback.
- **Testing**: Zero Regressions Rule (`make gate` / vitest must pass).

## 3. Component Specifications

### 3.1 Types (`ui/src/lib/types.ts`)
- **Additions**: 
  - `Provider`: added 'sambanova' | 'cerebras'
  - `PoolType`: 'COMMUNITY' | 'PRIVATE'
  - `CommunityRoutingStatus`: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED'
  - `CreateKeyPayload`: Add `pool_type`, `k1`, `k2`, `turnstile_token`.
  - `GlobalPoolTelemetry`, `ProviderPoolMetrics`, `ContributorStanding`.
- **Modifications**: Extend `APIKey` with optional Phase B fields.

### 3.2 Navigation (`ui/src/lib/TopNavBar.svelte`, `ui/src/lib/SideNavBar.svelte`)
- **TopNavBar**: Update edge version badge to `v4.0 Commons` using `primary` theme styling.
- **SideNavBar**: Add "Report / Takedown" emergency link above the "Support" link, routed to `handleTabClick('report')` and styling with `security` icon and error colors.

### 3.3 AddKeyModal (`ui/src/lib/AddKeyModal.svelte`)
- **Runes Integration**: Use `$state` for `selectedPoolType`, `attestK1`, `attestK2`, `turnstileToken`, etc. `$derived` for `canSubmit`.
- **UI Sections**:
  - Pool Mode Selector (Community vs Private).
  - Legal Attestations (K1, K2 checkboxes).
- **Behavior**: Forward `turnstileToken` as `x-turnstile-token` header, payload contains new fields. Client-side encryption removed in favor of HTTPS server-side encryption.

### 3.4 Pool Commons Tab (`ui/src/lib/PoolCommonsTab.svelte`)
- **Overhaul**: Replace stub with real sub-tabs: Community Pool, Provider Pools, My Contribution.
- **Runes Integration**: State for `telemetry`, `standing`, `activeSubTab`, `isLoading`. Load via `$effect`.
- **Features**: Live metrics UI with skeleton fallbacks, Eye-for-an-Eye lock state indicator, `<DebtLedgerWidget>` mounted in Contribution tab.

### 3.5 Developer Workbench (`ui/src/lib/Workbench.svelte`)
- **New Panel**: "My Contributed Provider Keys" above Project Credentials.
- **Runes Integration**: Use `$state` for `providerKeys`, `$derived` for filtered subsets (`communityKeys`, `observationKeys`).
- **Features**: Call `GET /api/keys` to render keys, display Observation countdown / pool mode badges. Inline actions (Rotate, Change Pool Mode, Delete).

### 3.6 ApiDocs Sandbox (`ui/src/lib/ApiDocs.svelte`)
- **Model Selector**: Update optgroups to feature Gemini, Groq, SambaNova, Cerebras (Free Tier).
- **Fallback Alert**: Implement cascade fallback state (`fallbackOccurred = actualModel !== requestedModel`).
- **Features**: Prominent amber banner explaining fallback events derived from `x-kc-model-used` headers.

## 4. Testing
Unit tests in `ui/src/lib/*.test.ts` must be strictly updated for `AddKeyModal` and `PoolCommonsTab` to cover all new behaviors.
