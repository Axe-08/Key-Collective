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

  $: activeUserAccount = data?.userAccount;
  $: activeProjects = data?.projects ?? [];
  $: activeKeys = data?.keys ?? [];
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
