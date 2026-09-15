<script lang="ts">
  import type { ExtendedKey, ExtendedProject } from './types';

  interface Props {
    keys: ExtendedKey[];
    projects: ExtendedProject[];
    keySearch: string;
    keyProjectFilter: string;
    copiedKeyId: string | null;
    openKeyDropdownId: string | null;
    onSearchChange: (val: string) => void;
    onProjectFilterChange: (val: string) => void;
    onCreateKeyClick: () => void;
    onCopyKeySecret: (secret: string, keyId: string) => void;
    onToggleKey: (keyId: string) => void;
    onRotateKey: (keyId: string) => void;
    onRevokeKey: (keyId: string) => void;
    onDeleteKey: (keyId: string) => void;
    onToggleDropdown: (keyId: string | null) => void;
    getProjectName: (projectId: string) => string;
  }

  let {
    keys,
    projects,
    keySearch = $bindable(''),
    keyProjectFilter = $bindable('all'),
    copiedKeyId,
    openKeyDropdownId,
    onCreateKeyClick,
    onCopyKeySecret,
    onToggleKey,
    onRotateKey,
    onRevokeKey,
    onDeleteKey,
    onToggleDropdown,
    getProjectName,
  }: Props = $props();
</script>

<section class="space-y-3">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
        Project-Scoped Virtual Tokens &amp; Credentials
      </h2>
      <p class="font-body-sm text-body-sm text-outline">
        Virtual credentials scoped to project routing contexts with automated rate-limits.
      </p>
    </div>

    <!-- Search & Project Select Filters -->
    <div class="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onclick={onCreateKeyClick}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 font-label-md text-label-md font-semibold hover:bg-primary/20 transition-colors cursor-pointer font-mono mr-2"
      >
        <span class="material-symbols-outlined text-[16px]">key</span>
        <span>Create Key</span>
      </button>
      <div class="relative">
        <span class="material-symbols-outlined text-outline text-[16px] absolute left-3 top-2.5">
          search
        </span>
        <input
          type="text"
          bind:value={keySearch}
          placeholder="Search keys or prefixes..."
          class="pl-8 pr-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary w-52 sm:w-64 transition-colors font-mono"
        />
      </div>
      <select
        bind:value={keyProjectFilter}
        class="px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary cursor-pointer transition-colors font-mono"
      >
        <option value="all">All Projects</option>
        {#each projects as proj}
          <option value={proj.id}>{proj.name}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Keys Table -->
  <div class="specular-card rounded-xl bg-surface-container-low/70 border border-outline-variant/20 overflow-hidden shadow-sm">
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse font-sans">
        <thead>
          <tr class="border-b border-outline-variant/20 bg-surface-container-lowest/70 font-label-sm text-label-sm text-outline uppercase tracking-wider font-mono">
            <th class="py-3 px-4">KEY NAME</th>
            <th class="py-3 px-4">ASSOCIATED PROJECT</th>
            <th class="py-3 px-4">TOKEN PREFIX &amp; SECRET</th>
            <th class="py-3 px-4">CREATED / LAST USED</th>
            <th class="py-3 px-4">STATUS</th>
            <th class="py-3 px-4 text-right">ACTIONS</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/10 font-body-sm text-body-sm">
          {#if keys.length === 0}
            <tr>
              <td colspan="6" class="py-8 text-center text-outline font-mono text-xs">
                No credentials found matching your filter criteria.
              </td>
            </tr>
          {:else}
            {#each keys as key (key.id)}
              <tr class="hover:bg-surface-container-high/40 transition-colors {key.isRevoked ? 'opacity-75' : ''}">
                <!-- Key Name -->
                <td class="py-3 px-4 font-code-sm text-code-sm font-semibold font-mono {key.isRevoked ? 'text-outline line-through' : 'text-on-surface'}">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {key.isRevoked ? 'bg-outline' : 'bg-secondary'}"></span>
                    <span>{key.name}</span>
                  </div>
                </td>

                <!-- Associated Project -->
                <td class="py-3 px-4">
                  <span class="font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant/20 font-mono {key.isRevoked ? 'text-outline' : 'text-on-surface'}">
                    {getProjectName(key.projectId)}
                  </span>
                </td>

                <!-- Token Prefix & Secret -->
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2 font-code-sm text-code-sm bg-surface-container-lowest px-2 py-1 rounded border border-outline-variant/10 w-fit font-mono {key.isRevoked ? 'opacity-60' : ''}">
                    <span class="{key.isRevoked ? 'text-outline' : 'text-primary'}">{key.tokenPrefix}</span>
                    <span class="text-outline">••••••••••••</span>
                    <button
                      type="button"
                      onclick={() => onCopyKeySecret(key.fullSecret || `${key.tokenPrefix}44781d09e`, key.id)}
                      class="text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Copy Key Secret"
                    >
                      {#if copiedKeyId === key.id}
                        <span class="material-symbols-outlined text-[14px] text-secondary">check</span>
                      {:else}
                        <span class="material-symbols-outlined text-[14px]">content_copy</span>
                      {/if}
                    </button>
                  </div>
                </td>

                <!-- Created / Last Used -->
                <td class="py-3 px-4 font-code-sm text-code-sm font-mono">
                  <div class="{key.isRevoked ? 'text-outline' : 'text-on-surface'}">
                    {key.displayTime || 'Just now'}
                  </div>
                  <div class="text-outline text-[10px]">
                    {key.displayCreated || 'Oct 14, 2024'}
                  </div>
                </td>

                <!-- Status (Toggle or Badge) -->
                <td class="py-3 px-4">
                  <label class="relative inline-flex items-center cursor-pointer" title={key.isRevoked ? "Click to Reactivate Key" : "Click to Revoke Key"}>
                    <input
                      type="checkbox"
                      checked={!key.isRevoked}
                      onchange={() => onToggleKey(key.id)}
                      class="sr-only peer"
                    />
                    <div class="w-9 h-5 bg-surface-container-high border border-outline-variant/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
                    <span class="ml-2 font-code-sm text-code-sm {key.isRevoked ? 'text-error font-medium' : 'text-secondary font-medium'} font-mono">
                      {key.isRevoked ? 'Revoked' : 'Active'}
                    </span>
                  </label>
                </td>

                <!-- Actions -->
                <td class="py-3 px-4 text-right font-mono">
                  <div class="flex items-center justify-end gap-1">
                    {#if key.isRevoked}
                      <button
                        type="button"
                        onclick={() => onToggleKey(key.id)}
                        class="px-2.5 py-1 rounded bg-secondary/10 hover:bg-secondary/20 text-secondary border border-secondary/20 font-label-sm text-label-sm transition-colors cursor-pointer mr-1"
                        title="Reactivate this key"
                      >
                        Reactivate
                      </button>
                      <button
                        type="button"
                        onclick={() => onDeleteKey(key.id)}
                        class="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-label-sm text-label-sm transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    {/if}
                    <div class="relative">
                      <button
                        type="button"
                        onclick={() => onToggleDropdown(openKeyDropdownId === key.id ? null : key.id)}
                        class="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface transition-colors cursor-pointer"
                      >
                        <span class="material-symbols-outlined text-[16px]">more_horiz</span>
                      </button>
                      {#if openKeyDropdownId === key.id}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="fixed inset-0 z-10" onclick={() => onToggleDropdown(null)}></div>
                        <div class="absolute right-0 mt-1 w-36 rounded-lg bg-surface-container-highest border border-outline-variant/30 shadow-xl z-20 p-1">
                          {#if !key.isRevoked}
                            <button
                              type="button"
                              onclick={() => { onToggleDropdown(null); onRotateKey(key.id); }}
                              class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-container-high rounded flex items-center gap-2 cursor-pointer transition-colors"
                            >
                              <span class="material-symbols-outlined text-[14px]">refresh</span>
                              Rotate Secret
                            </button>
                            <button
                              type="button"
                              onclick={() => { onToggleDropdown(null); onRevokeKey(key.id); }}
                              class="w-full text-left px-3 py-2 text-xs font-code-sm text-error hover:bg-error-container/20 rounded flex items-center gap-2 cursor-pointer transition-colors"
                            >
                              <span class="material-symbols-outlined text-[14px]">block</span>
                              Revoke
                            </button>
                          {:else}
                            <button
                              type="button"
                              onclick={() => { onToggleDropdown(null); onToggleKey(key.id); }}
                              class="w-full text-left px-3 py-2 text-xs font-code-sm text-secondary hover:bg-secondary/10 rounded flex items-center gap-2 cursor-pointer transition-colors"
                            >
                              <span class="material-symbols-outlined text-[14px]">check_circle</span>
                              Reactivate Key
                            </button>
                          {/if}
                          <button
                            type="button"
                            onclick={() => { onToggleDropdown(null); onDeleteKey(key.id); }}
                            class="w-full text-left px-3 py-2 text-xs font-code-sm text-error hover:bg-error-container/20 rounded flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <span class="material-symbols-outlined text-[14px]">delete</span>
                            Force Delete
                          </button>
                        </div>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</section>
