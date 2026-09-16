<script lang="ts">
  import type { ExtendedProject } from './types';

  interface Props {
    projects: ExtendedProject[];
    projectFilter: 'all' | 'live' | 'archived';
    liveProjectsCount: number;
    archivedProjectsCount: number;
    onFilterChange: (filter: 'all' | 'live' | 'archived') => void;
    onCreateProjectClick: () => void;
    onCreateKeyClick: () => void;
    onOpenSettings: (project: ExtendedProject) => void;
    onRotateKey: (projectId: string) => void;
    getProjectKeyCount: (projectId: string) => number;
  }

  let {
    projects,
    projectFilter,
    liveProjectsCount,
    archivedProjectsCount,
    onFilterChange,
    onCreateProjectClick,
    onCreateKeyClick,
    onOpenSettings,
    onRotateKey,
    getProjectKeyCount,
  }: Props = $props();
</script>

<section class="space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
        Multi-Project Management
      </h2>
      <!-- Filter Tabs: All, Live, Archived -->
      <div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg border border-outline-variant/20 font-mono">
        <button
          type="button"
          onclick={() => onFilterChange('all')}
          class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'all' ? 'bg-surface-container-high text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-high'}"
        >
          All Projects ({projects.length})
        </button>
        <button
          type="button"
          onclick={() => onFilterChange('live')}
          class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'live' ? 'bg-surface-container-high text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-high'}"
        >
          Live ({liveProjectsCount})
        </button>
        <button
          type="button"
          onclick={() => onFilterChange('archived')}
          class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'archived' ? 'bg-surface-container-high text-primary font-medium' : 'text-outline hover:bg-surface-container-high'}"
        >
          Archived ({archivedProjectsCount})
        </button>
      </div>
    </div>

    <!-- Create New Project Button -->
    <button
      type="button"
      onclick={onCreateProjectClick}
      class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-container text-on-primary-container font-label-md text-label-md font-semibold hover:opacity-90 transition-opacity shadow-[0_0_12px_rgba(128,131,255,0.2)] cursor-pointer font-mono"
    >
      <span class="material-symbols-outlined text-[16px]">add</span>
      <span>Create New Project</span>
    </button>
  </div>

  {#if projects.length === 0}
    <div class="p-8 text-center text-outline font-mono text-sm">No virtual projects configured yet. Click "Create New Project" to get started.</div>
  {/if}

  <!-- Project Cards Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    {#each projects as project (project.id)}
      {@const maxCap = project.maxRpmSubCap || 20}
      {@const keyCount = getProjectKeyCount(project.id)}
      {@const assignedRpm = project.assignedRpm !== undefined ? project.assignedRpm : (keyCount > 0 ? Math.min(maxCap, keyCount * 5) : 0)}
      {@const rpmPercent = maxCap > 0 ? Math.min(100, Math.round((assignedRpm / maxCap) * 100)) : 0}
      <div class="specular-card rounded-xl bg-surface-container-low/80 backdrop-blur border border-outline-variant/20 p-5 space-y-4 shadow-sm">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onclick={onCreateKeyClick}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 font-label-md text-label-md font-semibold hover:bg-primary/20 transition-colors cursor-pointer font-mono mr-2"
              >
                <span class="material-symbols-outlined text-[16px]">key</span>
                <span>Create Key</span>
              </button>
              <h3 class="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {project.name}
              </h3>
              {#if project.isArchived}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/20 text-outline font-label-sm text-label-sm font-mono">
                  Archived
                </span>
              {:else if project.latencyMs && project.latencyMs > 15}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-label-sm text-label-sm font-mono">
                  <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                  Live (Standby)
                </span>
              {:else}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/10 border border-secondary/30 text-secondary font-label-sm text-label-sm font-mono">
                  <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                  Live (Healthy)
                </span>
              {/if}
            </div>
            <div class="font-code-sm text-code-sm text-outline mt-0.5 font-mono">
              slug: <span class="text-on-surface-variant font-medium">{project.slug}</span>
            </div>
          </div>

          <span class="p-2 rounded-lg bg-surface-container {project.iconColor || 'text-primary'}">
            <span class="material-symbols-outlined text-[20px]">{project.icon || 'hub'}</span>
          </span>
        </div>

        <!-- Meter and Stats -->
        <div class="space-y-2 bg-surface-container-lowest/60 p-3 rounded-lg border border-outline-variant/10">
          <div class="flex justify-between items-center font-code-sm text-code-sm font-mono">
            <span class="text-on-surface-variant">Assigned RPM Sub-cap</span>
            <span class="text-on-surface font-medium">
              {assignedRpm} / {maxCap} RPM
              <span class="font-bold {rpmPercent >= 50 ? 'text-primary' : 'text-secondary'}">
                ({rpmPercent}%)
              </span>
            </span>
          </div>
          <div class="h-2 w-full bg-surface-container rounded-full overflow-hidden">
            <div
              class="h-full rounded-full {rpmPercent >= 50 ? 'bg-primary' : 'bg-secondary'}"
              style="width: {rpmPercent}%"
            ></div>
          </div>
          <div class="flex items-center justify-between pt-1 text-xs font-code-sm text-on-surface-variant font-mono">
            <span>Active Keys: <span class="text-on-surface font-medium">{keyCount} Active Key{keyCount !== 1 ? 's' : ''}</span></span>
            <span>Latency: <span class="text-secondary font-medium">{project.latency || '12ms avg'}</span></span>
          </div>
        </div>

        <!-- Card Actions -->
        <div class="flex items-center justify-between pt-2 border-t border-outline-variant/20">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => onOpenSettings(project)}
              class="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors cursor-pointer"
            >
              Project Settings
            </button>
            <button
              type="button"
              onclick={() => onRotateKey(project.id)}
              class="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span class="material-symbols-outlined text-[14px]">sync</span>
              Rotate Key
            </button>
          </div>
          <button
            type="button"
            onclick={() => onOpenSettings(project)}
            class="text-outline hover:text-on-surface p-1 transition-colors cursor-pointer"
          >
            <span class="material-symbols-outlined text-[18px]">more_vert</span>
          </button>
        </div>
      </div>
    {/each}
  </div>
</section>
