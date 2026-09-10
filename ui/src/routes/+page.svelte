<script context="module" lang="ts">
  import type { UserAccount, Project, ProjectKey } from '../../../src/contracts/v3_types';

  export interface PageData {
    userAccount?: UserAccount;
    projects?: Project[];
    keys?: ProjectKey[];
    [key: string]: unknown;
  }
</script>

<script lang="ts">
  import Workbench from '../lib/Workbench.svelte';

  export let data: PageData;

  const mockUserAccount: UserAccount = {
    id: 'usr_mock_001',
    githubId: 12345678,
    githubUsername: 'collective-dev',
    primaryEmail: 'dev@keycollective.io',
    tier: 'builder',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
    isEmailVerified: true,
    githubCreatedAt: '2023-01-01T00:00:00.000Z',
    sybilScore: 92,
    registrationIp: '127.0.0.1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };

  const mockProjects: Project[] = [
    {
      id: 'proj_mock_01',
      tenantId: 'usr_mock_001',
      name: 'Core Gateway',
      slug: 'core-gateway',
      description: 'Primary AI routing gateway and key pool',
      maxRpmSubCap: 20,
      isArchived: false,
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z'
    }
  ];

  const mockKeys: ProjectKey[] = [
    {
      id: 'key_mock_01',
      projectId: 'proj_mock_01',
      tenantId: 'usr_mock_001',
      name: 'Production Key',
      tokenPrefix: 'kc_proj_live',
      tokenHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      isRevoked: false,
      lastUsedAt: '2024-01-03T12:00:00.000Z',
      createdAt: '2024-01-02T00:00:00.000Z'
    }
  ];

  $: activeUserAccount = data?.userAccount ?? mockUserAccount;
  $: activeProjects = data?.projects ?? mockProjects;
  $: activeKeys = data?.keys ?? mockKeys;
</script>

<div class="workbench-route-container">
  <Workbench
    userAccount={activeUserAccount}
    projects={activeProjects}
    keys={activeKeys}
  />
</div>

<style>
  .workbench-route-container {
    width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
</style>
