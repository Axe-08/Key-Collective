<script lang="ts">
  import type { ExtendedProject } from './types';

  interface Props {
    // Verification proof modal
    showVerificationProofModal: boolean;
    onCloseVerificationProofModal: () => void;

    // New project modal
    showNewProjectModal: boolean;
    onCloseNewProjectModal: () => void;
    onCreateProjectSubmit: () => void;
    newProjectName: string;
    newProjectSlug: string;
    newProjectDesc: string;
    newProjectRpm: number;

    // New key modal
    showNewKeyModal: boolean;
    onCloseNewKeyModal: () => void;
    onCreateKeySubmit: () => void;
    newKeyName: string;
    newKeyProjectId: string;
    projects: ExtendedProject[];

    // Project settings modal
    showProjectSettingsModal: ExtendedProject | null;
    onCloseProjectSettingsModal: () => void;
    onArchiveProjectToggle: (projectId: string) => void;
    onSaveProjectName: (projectId: string, name: string) => void;
    onSaveProjectRpm: (projectId: string, rpm: number) => void;
    localKeys: any[];

    // Switch pool modal
    switchPoolModalOpen: boolean;
    switchPoolTarget: { keyId: string; targetPool: 'COMMUNITY' | 'PRIVATE' } | null;
    switchPoolLoading: boolean;
    switchPoolError: string | null;
    onCloseSwitchPoolModal: () => void;
    onConfirmSwitchPool: () => void;
  }

  let {
    showVerificationProofModal,
    onCloseVerificationProofModal,
    showNewProjectModal,
    onCloseNewProjectModal,
    onCreateProjectSubmit,
    newProjectName = $bindable(''),
    newProjectSlug = $bindable(''),
    newProjectDesc = $bindable(''),
    newProjectRpm = $bindable(10),
    showNewKeyModal,
    onCloseNewKeyModal,
    onCreateKeySubmit,
    newKeyName = $bindable(''),
    newKeyProjectId = $bindable(''),
    projects,
    showProjectSettingsModal,
    onCloseProjectSettingsModal,
    onArchiveProjectToggle,
    onSaveProjectName,
    onSaveProjectRpm,
    localKeys,
    switchPoolModalOpen,
    switchPoolTarget,
    switchPoolLoading,
    switchPoolError,
    onCloseSwitchPoolModal,
    onConfirmSwitchPool,
  }: Props = $props();

  let editingProjectName = $state(false);
  let editProjectNameValue = $state('');
  let editProjectRpmValue = $state(0);

  $effect(() => {
    if (showProjectSettingsModal) {
      editProjectNameValue = showProjectSettingsModal.name;
      editProjectRpmValue = showProjectSettingsModal.maxRpmSubCap || 20;
      editingProjectName = false;
    }
  });
</script>

<!-- Verification Proof Modal -->
{#if showVerificationProofModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onCloseVerificationProofModal}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-lg w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-secondary">verified</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Cryptographic Proof &amp; Sybil Attestation
          </h3>
        </div>
        <button
          type="button"
          onclick={onCloseVerificationProofModal}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="space-y-3 font-mono text-xs text-on-surface-variant">
        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Turnstile Challenge Signature</div>
          <div class="text-secondary break-all">
            0x4a9b91c0e35f8d227b4012fa1982bca81498b3017f8a329d91f801ca458d92e1
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Edge Node Attestation Key</div>
          <div class="text-primary break-all">
            ed25519:iad-edge-01:99a81f3b20ce19da01f28b4931a77481c
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Sybil Risk Vector Analysis</div>
          <div class="text-on-surface">Score: <strong class="text-secondary">92 / 100</strong> • Risk tier: LOW</div>
          <div class="text-outline text-[11px]">ASN 13335 (Dedicated Cloudflare Edge Transit) • Zero Tor/Proxy hops detected.</div>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button
          type="button"
          onclick={onCloseVerificationProofModal}
          class="px-4 py-2 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          Close Proof
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Create New Project Modal -->
{#if showNewProjectModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onCloseNewProjectModal}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">add_box</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Create New Project
          </h3>
        </div>
        <button
          type="button"
          onclick={onCloseNewProjectModal}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <form onsubmit={(e) => { e.preventDefault(); onCreateProjectSubmit(); }} class="space-y-3 font-sans">
        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-name">Project Name</label>
          <input
            id="np-name"
            type="text"
            bind:value={newProjectName}
            placeholder="e.g., Voice Agent Gateway"
            required
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-slug">Project Slug</label>
          <input
            id="np-slug"
            type="text"
            bind:value={newProjectSlug}
            placeholder="e.g., voice-agent-gateway"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-desc">Description</label>
          <input
            id="np-desc"
            type="text"
            bind:value={newProjectDesc}
            placeholder="Optional project purpose or routing domain"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-rpm">RPM Sub-Cap Limit</label>
          <input
            id="np-rpm"
            type="number"
            min="1"
            max="100"
            bind:value={newProjectRpm}
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={onCloseNewProjectModal}
            class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Create Project
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Create New Key Modal -->
{#if showNewKeyModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onCloseNewKeyModal}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">key</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Create New Project Key
          </h3>
        </div>
        <button
          type="button"
          onclick={onCloseNewKeyModal}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <form onsubmit={(e) => { e.preventDefault(); onCreateKeySubmit(); }} class="space-y-3 font-sans">
        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="nk-name">Key Name</label>
          <input
            id="nk-name"
            type="text"
            bind:value={newKeyName}
            placeholder="e.g., prod-gateway-v3"
            required
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="nk-proj">Select Project</label>
          <select
            id="nk-proj"
            bind:value={newKeyProjectId}
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary cursor-pointer"
          >
            {#each projects as proj}
              <option value={proj.id}>{proj.name}</option>
            {/each}
          </select>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={onCloseNewKeyModal}
            class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Create Key
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Project Settings Modal -->
{#if showProjectSettingsModal}
  {@const modalProj = showProjectSettingsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onCloseProjectSettingsModal}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      {#if modalProj.isArchived}
        <div class="bg-error-container/20 border border-error/30 text-error p-3 rounded-lg font-mono text-xs flex items-start gap-2">
          <span class="material-symbols-outlined text-[16px]">warning</span>
          <div>
            <strong>Project Archived (Suspended)</strong><br />
            API requests using this project's keys will be rejected.
          </div>
        </div>
      {/if}

      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2 flex-1">
          <span class="material-symbols-outlined text-primary">settings</span>
          {#if editingProjectName}
            <input
              type="text"
              bind:value={editProjectNameValue}
              class="px-2 py-1 bg-surface-container border border-outline-variant/30 rounded font-headline-sm text-headline-sm font-semibold text-on-surface focus:outline-none focus:border-primary flex-1 min-w-0"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  onSaveProjectName(modalProj.id, editProjectNameValue);
                  editingProjectName = false;
                } else if (e.key === 'Escape') {
                  editingProjectName = false;
                }
              }}
            />
            <button
              type="button"
              onclick={() => {
                onSaveProjectName(modalProj.id, editProjectNameValue);
                editingProjectName = false;
              }}
              class="text-primary hover:text-primary-variant cursor-pointer"
            >
              <span class="material-symbols-outlined text-[18px]">save</span>
            </button>
          {:else}
            <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">
              {modalProj.name} Settings
            </h3>
            <button
              type="button"
              onclick={() => {
                editingProjectName = true;
                editProjectNameValue = modalProj.name;
              }}
              class="text-outline hover:text-on-surface cursor-pointer ml-1"
            >
              <span class="material-symbols-outlined text-[16px]">edit</span>
            </button>
          {/if}
        </div>
        <button
          type="button"
          onclick={onCloseProjectSettingsModal}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer ml-4 shrink-0"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="space-y-3 font-mono text-xs text-on-surface-variant">
        <div>
          <span class="text-outline">Project ID:</span>
          <code class="ml-2 text-on-surface">{modalProj.id}</code>
        </div>
        <div>
          <span class="text-outline">Slug:</span>
          <code class="ml-2 text-primary">{modalProj.slug}</code>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-outline">Assigned Sub-Cap:</span>
          <input
            type="number"
            min="1"
            max="100"
            bind:value={editProjectRpmValue}
            onblur={() => onSaveProjectRpm(modalProj.id, editProjectRpmValue)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                onSaveProjectRpm(modalProj.id, editProjectRpmValue);
                e.currentTarget.blur();
              }
            }}
            class="w-20 px-2 py-0.5 bg-surface-container border border-outline-variant/30 rounded text-on-surface focus:outline-none focus:border-primary"
          />
          <span class="text-on-surface">RPM</span>
        </div>
        <div>
          <span class="text-outline">Status:</span>
          <span class="ml-2 {modalProj.isArchived ? 'text-error' : 'text-secondary'} font-medium">
            {modalProj.isArchived ? 'Archived' : 'Active (Healthy)'}
          </span>
        </div>
      </div>

      <div class="pt-2 border-t border-outline-variant/20">
        <div class="text-outline font-mono text-xs mb-2 font-semibold">Assigned Keys</div>
        <div class="max-h-32 overflow-y-auto space-y-1 custom-scrollbar pr-1">
          {#each localKeys.filter(k => k.projectId === modalProj.id) as key}
            <div class="flex items-center justify-between p-2 rounded bg-surface-container-lowest border border-outline-variant/10 font-mono text-xs {key.isRevoked ? 'opacity-60' : ''}">
              <div class="flex items-center gap-2 overflow-hidden">
                <span class="material-symbols-outlined text-[14px] {key.isRevoked ? 'text-outline' : 'text-secondary'}">
                  {key.isRevoked ? 'block' : 'key'}
                </span>
                <span class="truncate {key.isRevoked ? 'text-outline line-through' : 'text-on-surface'}">{key.name}</span>
              </div>
              <span class="text-outline shrink-0">{key.tokenPrefix}</span>
            </div>
          {:else}
            <div class="text-outline font-mono text-xs italic">No keys assigned to this project.</div>
          {/each}
        </div>
      </div>

      <div class="flex justify-between items-center pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onclick={() => onArchiveProjectToggle(modalProj.id)}
          class="px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer {modalProj.isArchived ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-error-container/20 border-error/20 text-error hover:bg-error-container/40'}"
        >
          {modalProj.isArchived ? 'Unarchive Project' : 'Archive Project'}
        </button>
        <button
          type="button"
          onclick={onCloseProjectSettingsModal}
          class="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Switch Pool Modal -->
{#if switchPoolModalOpen && switchPoolTarget}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onCloseSwitchPoolModal}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-3 border-b border-outline-variant/20 pb-3">
        <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
          <span class="material-symbols-outlined text-primary text-[18px]">swap_horiz</span>
        </div>
        <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">Confirm Pool Switch</h3>
      </div>
      
      <div class="text-body-sm font-body-sm text-on-surface-variant">
        {#if switchPoolTarget.targetPool === 'COMMUNITY'}
          <p class="mb-2">Switching this key to the Community Pool enters a 24-hour observation period (OBSERVATION status) before receiving reciprocal community routing credits.</p>
          <p class="font-semibold text-amber-400">Pool switches are frozen during the midnight UTC reset window (23:30–00:30 UTC).</p>
        {:else}
          <p>Switching this key to Private will remove it from the reciprocal Community Pool immediately. It will only serve your personal requests.</p>
        {/if}
      </div>

      {#if switchPoolError}
        <div class="p-3 bg-error/10 border border-error/20 text-error text-xs rounded-lg mt-2">
          {switchPoolError}
        </div>
      {/if}

      <div class="flex justify-end gap-3 pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onclick={onCloseSwitchPoolModal}
          disabled={switchPoolLoading}
          class="px-4 py-2 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-container-high transition-colors font-semibold text-sm cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirmSwitchPool}
          disabled={switchPoolLoading}
          class="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
        >
          {#if switchPoolLoading}
            <span class="material-symbols-outlined animate-spin text-[16px]">refresh</span>
          {/if}
          Confirm Switch
        </button>
      </div>
    </div>
  </div>
{/if}
