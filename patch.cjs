const fs = require('fs');
const content = fs.readFileSync('ui/src/lib/Workbench.svelte', 'utf8');

// We need to inject state variables for editing the project name and RPM
const scriptStateInjection = `  let showProjectSettingsModal = $state<ExtendedProject | null>(null);
  let editingProjectName = $state(false);
  let editProjectNameValue = $state('');
  let editProjectRpmValue = $state(0);
`;
let newContent = content.replace("  let showProjectSettingsModal = $state<ExtendedProject | null>(null);", scriptStateInjection);

const clickHandlers = `onclick={() => {
                  showProjectSettingsModal = project;
                  editingProjectName = false;
                  editProjectNameValue = project.name;
                  editProjectRpmValue = project.maxRpmSubCap || 20;
                }}`;
newContent = newContent.replace(/onclick=\{\(\) => \(showProjectSettingsModal = project\)\}/g, clickHandlers);

// Update Modal content
const modalContentOld = `<!-- Project Settings Modal -->
{#if showProjectSettingsModal}
  {@const modalProj = showProjectSettingsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => (showProjectSettingsModal = null)}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">settings</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            {modalProj.name} Settings
          </h3>
        </div>
        <button
          type="button"
          onclick={() => (showProjectSettingsModal = null)}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
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
        <div>
          <span class="text-outline">Assigned Sub-Cap:</span>
          <span class="ml-2 text-on-surface">{modalProj.maxRpmSubCap || 20} RPM</span>
        </div>
        <div>
          <span class="text-outline">Status:</span>
          <span class="ml-2 {modalProj.isArchived ? 'text-outline' : 'text-secondary'}">
            {modalProj.isArchived ? 'Archived' : 'Active (Healthy)'}
          </span>
        </div>
      </div>

      <div class="flex justify-between items-center pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onclick={() => {
            localProjects = localProjects.map((p) =>
              p.id === modalProj.id ? { ...p, isArchived: !p.isArchived } : p
            );
            showProjectSettingsModal = null;
          }}
          class="px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer {modalProj.isArchived ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-error-container/20 border-error/20 text-error'}"
        >
          {modalProj.isArchived ? 'Unarchive Project' : 'Archive Project'}
        </button>
        <button
          type="button"
          onclick={() => (showProjectSettingsModal = null)}
          class="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}`;

const modalContentNew = `<!-- Project Settings Modal -->
{#if showProjectSettingsModal}
  {@const modalProj = showProjectSettingsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => (showProjectSettingsModal = null)}
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
                  localProjects = localProjects.map(p => p.id === modalProj.id ? { ...p, name: editProjectNameValue } : p);
                  showProjectSettingsModal = localProjects.find(p => p.id === modalProj.id);
                  editingProjectName = false;
                } else if (e.key === 'Escape') {
                  editingProjectName = false;
                }
              }}
            />
            <button
              type="button"
              onclick={() => {
                localProjects = localProjects.map(p => p.id === modalProj.id ? { ...p, name: editProjectNameValue } : p);
                showProjectSettingsModal = localProjects.find(p => p.id === modalProj.id);
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
          onclick={() => (showProjectSettingsModal = null)}
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
            onblur={() => {
              localProjects = localProjects.map(p => p.id === modalProj.id ? { ...p, maxRpmSubCap: editProjectRpmValue, assignedRpm: Math.round(editProjectRpmValue * 0.7) } : p);
              showProjectSettingsModal = localProjects.find(p => p.id === modalProj.id);
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                localProjects = localProjects.map(p => p.id === modalProj.id ? { ...p, maxRpmSubCap: editProjectRpmValue, assignedRpm: Math.round(editProjectRpmValue * 0.7) } : p);
                showProjectSettingsModal = localProjects.find(p => p.id === modalProj.id);
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
          onclick={() => {
            localProjects = localProjects.map((p) =>
              p.id === modalProj.id ? { ...p, isArchived: !p.isArchived } : p
            );
            showProjectSettingsModal = localProjects.find(p => p.id === modalProj.id);
          }}
          class="px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer {modalProj.isArchived ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-error-container/20 border-error/20 text-error hover:bg-error-container/40'}"
        >
          {modalProj.isArchived ? 'Unarchive Project' : 'Archive Project'}
        </button>
        <button
          type="button"
          onclick={() => (showProjectSettingsModal = null)}
          class="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}`;

newContent = newContent.replace(modalContentOld, modalContentNew);

fs.writeFileSync('ui/src/lib/Workbench.svelte', newContent);
