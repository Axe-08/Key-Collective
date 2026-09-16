<script lang="ts">
  import type { ExtendedProject } from '../types';

  interface Props {
    project: ExtendedProject | null;
    localKeys: any[];
    onClose: () => void;
    onArchiveToggle: (projectId: string) => void;
    onSaveName: (projectId: string, name: string) => void;
    onSaveRpm: (projectId: string, rpm: number) => void;
    onDeleteProject?: (projectId: string) => void;
  }

  let {
    project,
    localKeys,
    onClose,
    onArchiveToggle,
    onSaveName,
    onSaveRpm,
    onDeleteProject,
  }: Props = $props();

  let editingProjectName = $state(false);
  let editProjectNameValue = $state('');
  let editProjectRpmValue = $state(0);

  $effect(() => {
    if (project) {
      editProjectNameValue = project.name;
      editProjectRpmValue = project.maxRpmSubCap || 20;
      editingProjectName = false;
    }
  });
</script>

{#if project}
  {@const modalProj = project}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onClose}
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
                  onSaveName(modalProj.id, editProjectNameValue);
                  editingProjectName = false;
                } else if (e.key === 'Escape') {
                  editingProjectName = false;
                }
              }}
            />
            <button
              type="button"
              onclick={() => {
                onSaveName(modalProj.id, editProjectNameValue);
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
          onclick={onClose}
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
            max="10000"
            bind:value={editProjectRpmValue}
            oninput={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              editProjectRpmValue = val;
              if (val > 0) {
                onSaveRpm(modalProj.id, val);
              }
            }}
            onblur={() => onSaveRpm(modalProj.id, Number(editProjectRpmValue))}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                onSaveRpm(modalProj.id, Number(editProjectRpmValue));
                e.currentTarget.blur();
              }
            }}
            class="w-24 px-2 py-0.5 bg-surface-container border border-outline-variant/30 rounded text-on-surface focus:outline-none focus:border-primary"
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

      <div class="flex justify-between items-center pt-3 border-t border-outline-variant/20 gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={() => onArchiveToggle(modalProj.id)}
            class="px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer {modalProj.isArchived ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}"
          >
            {modalProj.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          {#if onDeleteProject}
            <button
              type="button"
              onclick={() => {
                onDeleteProject(modalProj.id);
                onClose();
              }}
              class="px-3 py-1.5 rounded-lg border border-error/30 bg-error-container/20 text-error hover:bg-error-container/40 font-mono text-xs transition-colors cursor-pointer"
            >
              Delete Project
            </button>
          {/if}
        </div>
        <button
          type="button"
          onclick={() => {
            if (editingProjectName && editProjectNameValue.trim()) {
              onSaveName(modalProj.id, editProjectNameValue.trim());
            }
            if (editProjectRpmValue > 0) {
              onSaveRpm(modalProj.id, Number(editProjectRpmValue));
            }
            onClose();
          }}
          class="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}
