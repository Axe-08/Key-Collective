# UI Design Specification: pod-ui-v4 (Key Collective v4.0 Commons)

## Overview
This document outlines the UI component design and implementation specifications for Phase A of the Key Collective v4.0 Commons (pod-ui-v4). It focuses on integrating new Svelte 5 Runes (`$state`, `$derived`, `$effect`, `$props`) and strict TypeScript definitions into the existing UI components.

The updates affect navigation, types, API documentation sandbox, provider key management, and the common pool UI, ensuring alignment with the v4.0 backend capabilities.

---

## 1. Type Definitions (`ui/src/lib/types.ts`)

The foundation of the v4.0 UI requires extending existing types to support new pool structures, legal attestations, and provider expansion.

### Strict TypeScript Enhancements

```typescript
// Expanded Providers
export type Provider = 'gemini' | 'groq' | 'sambanova' | 'cerebras';

// Pool & Routing Types
export type PoolType = 'COMMUNITY' | 'PRIVATE';
export type CommunityRoutingStatus = 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED';

// APIKey Extensions (Mapped from D1 schema)
export interface APIKey {
  // ... existing fields ...
  pool_type?: PoolType;
  community_routing_status?: CommunityRoutingStatus;
  observation_until?: string | null;
  dispatched_today?: number;
  dispatched_communal?: number;
  vesting_tier?: 0 | 1 | 2;
}

// Payload for POST /api/keys
export interface CreateKeyPayload {
  // ... existing fields ...
  pool_type: PoolType;
  k1: boolean;
  k2: boolean;
  turnstile_token: string;
}

// Telemetry & Contributor Standings
export interface ProviderPoolMetrics {
  provider: Provider;
  active_keys: number;
  quarantined_keys: number;
  observation_keys: number;
  u_pool_percent: number;
  w_provider: number;
  p90_latency_ms: number;
  eye_for_eye_accessible: boolean;
}

export interface GlobalPoolTelemetry {
  total_active_keys: number;
  keys_in_observation: number;
  keys_quarantined: number;
  pool_utilization_percent: number;
  provider_pools: ProviderPoolMetrics[];
  snapshot_time: string;
}

export interface ContributorStanding {
  multiplier: number;
  multiplier_ceiling: number;
  community_debt_cu: number;
  daily_contributed_cu: number;
  trusted_contributor: boolean;
  jail_status: 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL';
  consecutive_debt_free_days: number;
}
```

---

## 2. Navigation Components

### 2.1 TopNavBar (`ui/src/lib/TopNavBar.svelte`)
- **Cosmetic Update**: Change edge version badge from `v3.5 Edge` to `v4.0 Commons`.
- **Styling**: `bg-primary/10 text-primary border-primary/30`.

### 2.2 SideNavBar (`ui/src/lib/SideNavBar.svelte`)
- **New Link**: Add "Report / Takedown" emergency link above the "Support" link.
- **Action**: Routes to `handleTabClick('report')`.
- **Styling**: Uses Material Symbols `security` icon and error/danger colors (`text-error/70`, `hover:bg-error/5`).

---

## 3. AddKeyModal (`ui/src/lib/AddKeyModal.svelte`)

This is the primary ingestion point for new provider keys, incorporating legal assertions and cloudflare turnstile.

### Runes Implementation

```svelte
<script lang="ts">
  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
    onAddKey?: (payload: CreateKeyPayload) => Promise<void>;
  }
  let { isOpen = false, onClose, onAddKey }: Props = $props();

  // Reactive state
  let selectedPoolType = $state<PoolType>('COMMUNITY');
  let attestK1 = $state<boolean>(false);
  let attestK2 = $state<boolean>(false);
  let turnstileToken = $state<string>('');
  
  let keyInput = $state('');
  let labelInput = $state('');
  let isSubmitting = $state(false);

  // Derived submit state
  let canSubmit = $derived(
    !isSubmitting &&
    keyInput.trim().length > 0 &&
    labelInput.trim().length > 0 &&
    attestK1 &&
    attestK2
  );
</script>
```

### Key UI Sections
1. **Pool Mode Selector**: Radio-style selection between "Community Pool" (Recommended) and "Private Pool".
2. **Legal Attestations**: Checkboxes for K1 (no billing attached) and K2 (authorized creator).
3. **Security**: Form submission must append `x-turnstile-token: turnstileToken` to headers and stop client-side encryption.

---

## 4. Pool Commons Tab (`ui/src/lib/PoolCommonsTab.svelte`)

Complete overhaul to show live global telemetry and user contribution standings.

### Runes Implementation

```svelte
<script lang="ts">
  import DebtLedgerWidget from './DebtLedgerWidget.svelte';
  import type { GlobalPoolTelemetry, ContributorStanding } from './types';
  
  interface Props {
    authToken?: string;
    tenantId?: string;
  }
  let { authToken = '', tenantId = '' }: Props = $props();

  // State definitions
  let activeSubTab = $state<'community' | 'providers' | 'contribution'>('community');
  let telemetry = $state<GlobalPoolTelemetry | null>(null);
  let standing = $state<ContributorStanding | null>(null);
  let isLoading = $state(true);
  let loadError = $state<string | null>(null);

  // Fetch logic on mount
  $effect(() => {
    Promise.all([
      fetchPoolTelemetry(authToken),
      fetchContributorStanding(authToken)
    ]).then(([t, s]) => {
      telemetry = t;
      standing = s;
    }).catch(e => {
      loadError = e.message;
    }).finally(() => {
      isLoading = false;
    });
  });
</script>
```

### Sub-tabs Structure
- **Community Pool**: Displays global pool health and observation pipeline metrics.
- **Provider Pools**: Renders a table matrix of `ProviderPoolMetrics`, specifically emphasizing the Eye-for-an-Eye lock state.
- **My Contribution**: Renders the `<DebtLedgerWidget>` alongside the `ContributorStanding` stats (CU balance, multiplier).

---

## 5. Developer Workbench (`ui/src/lib/Workbench.svelte`)

Introduces a new "My Contributed Provider Keys" panel above the existing Project Credentials segment.

### Runes Implementation

```svelte
<script lang="ts">
  import type { APIKey } from './types';

  // Provider keys state
  let providerKeys = $state<APIKey[]>([]);
  let providerKeysLoading = $state(false);
  let providerKeysError = $state<string | null>(null);

  // Derived categorized keys
  let communityKeys = $derived(providerKeys.filter(k => k.pool_type === 'COMMUNITY'));
  let observationKeys = $derived(providerKeys.filter(k => k.community_routing_status === 'OBSERVATION'));

  // Logic to load provider keys from /api/keys
  // ...
</script>
```

### UI Specifications
- **Data Table**: Columns for Provider, Label, Key (Prefix...Suffix), Status (with Observation countdown UI), and Pool Mode.
- **Actions**: Inline dropdown for Rotate, Change Pool Mode, and Delete.
- **Empty State**: Friendly CTA pointing to the AddKeyModal.

---

## 6. ApiDocs Sandbox (`ui/src/lib/ApiDocs.svelte`)

Updating the model catalog to align with free-tier providers and providing visual feedback for cascade events.

### Runes Implementation

```svelte
<script lang="ts">
  // State for fallback
  let fallbackOccurred = $state(false);
  let requestedModel = $state('');
  let actualModelUsed = $state('');
  let actualProvider = $state('');

  // Fetch intercept to check headers
  // const kcModel = response.headers.get('x-kc-model-used');
  // fallbackOccurred = kcModel !== selectedModel;
</script>
```

### UI Specifications
- **Model Selector**: Uses `<optgroup>` categorizing models by Free Tier providers (Google Gemini, GroqCloud, SambaNova, Cerebras).
- **Fallback Alert**: An amber-colored `role="alert"` banner displayed when the returned `x-kc-model-used` header differs from the requested model, suggesting the user add a provider key.

---
