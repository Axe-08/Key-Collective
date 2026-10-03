<script lang="ts">
  import type { ExtendedProject } from './types';
  import NewProjectModal from './modals/NewProjectModal.svelte';
  import NewKeyModal from './modals/NewKeyModal.svelte';
  import ProjectSettingsModal from './modals/ProjectSettingsModal.svelte';
  import SwitchPoolModal from './modals/SwitchPoolModal.svelte';
  import SecretRevealModal from './modals/SecretRevealModal.svelte';

  interface Props {
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
    newKeyProjectId: string;
    projects: ExtendedProject[];

    // Project settings modal
    showProjectSettingsModal: ExtendedProject | null;
    onCloseProjectSettingsModal: () => void;
    onArchiveProjectToggle: (projectId: string) => void;
    onSaveProjectName: (projectId: string, name: string) => void;
    onSaveProjectRpm: (projectId: string, rpm: number) => void;
    onDeleteProject?: (projectId: string) => void;
    projectSettingsError?: string | null;
    localKeys: any[];

    // One-time secret display
    revealedSecret?: string | null;
    onCloseSecret?: () => void;

    // Switch pool modal
    switchPoolModalOpen: boolean;
    switchPoolTarget: { keyId: string; targetPool: 'COMMUNITY' | 'PRIVATE' } | null;
    switchPoolLoading: boolean;
    switchPoolError: string | null;
    onCloseSwitchPoolModal: () => void;
    onConfirmSwitchPool: () => void;
  }

  let {
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
    newKeyProjectId = $bindable(''),
    projects,
    showProjectSettingsModal,
    onCloseProjectSettingsModal,
    onArchiveProjectToggle,
    onSaveProjectName,
    onSaveProjectRpm,
    onDeleteProject,
    projectSettingsError = null,
    localKeys,
    revealedSecret = null,
    onCloseSecret = () => {},
    switchPoolModalOpen,
    switchPoolTarget,
    switchPoolLoading,
    switchPoolError,
    onCloseSwitchPoolModal,
    onConfirmSwitchPool,
  }: Props = $props();
</script>

<NewProjectModal
  show={showNewProjectModal}
  bind:name={newProjectName}
  bind:slug={newProjectSlug}
  bind:desc={newProjectDesc}
  bind:rpm={newProjectRpm}
  onClose={onCloseNewProjectModal}
  onSubmit={onCreateProjectSubmit}
/>

<NewKeyModal
  show={showNewKeyModal}
  bind:projectId={newKeyProjectId}
  {projects}
  onClose={onCloseNewKeyModal}
  onSubmit={onCreateKeySubmit}
/>

<ProjectSettingsModal
  project={showProjectSettingsModal}
  {localKeys}
  onClose={onCloseProjectSettingsModal}
  onArchiveToggle={onArchiveProjectToggle}
  onSaveName={onSaveProjectName}
  onSaveRpm={onSaveProjectRpm}
  {onDeleteProject}
  inlineError={projectSettingsError}
/>

<SecretRevealModal secret={revealedSecret} onClose={onCloseSecret} />

<SwitchPoolModal
  open={switchPoolModalOpen}
  target={switchPoolTarget}
  loading={switchPoolLoading}
  error={switchPoolError}
  onClose={onCloseSwitchPoolModal}
  onConfirm={onConfirmSwitchPool}
/>
