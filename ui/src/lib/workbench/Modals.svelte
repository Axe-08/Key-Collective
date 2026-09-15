<script lang="ts">
  import type { ExtendedProject } from './types';
  import VerificationProofModal from './modals/VerificationProofModal.svelte';
  import NewProjectModal from './modals/NewProjectModal.svelte';
  import NewKeyModal from './modals/NewKeyModal.svelte';
  import ProjectSettingsModal from './modals/ProjectSettingsModal.svelte';
  import SwitchPoolModal from './modals/SwitchPoolModal.svelte';

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
</script>

<VerificationProofModal
  show={showVerificationProofModal}
  onClose={onCloseVerificationProofModal}
/>

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
  bind:name={newKeyName}
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
/>

<SwitchPoolModal
  open={switchPoolModalOpen}
  target={switchPoolTarget}
  loading={switchPoolLoading}
  error={switchPoolError}
  onClose={onCloseSwitchPoolModal}
  onConfirm={onConfirmSwitchPool}
/>
