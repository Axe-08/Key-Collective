<script lang="ts">
  let {
    rpmLimit = $bindable(),
    rpdLimit = $bindable(),
    priority = $bindable(),
  }: {
    rpmLimit: number;
    rpdLimit: number;
    priority: number;
  } = $props();
</script>

<div class="grid grid-cols-3 gap-3">
  <!-- RPM Limit -->
  <div>
    <label for="rpm-limit" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">
      RPM Limit
    </label>
    <input
      id="rpm-limit"
      type="number"
      min="1"
      max="10000"
      bind:value={rpmLimit}
      required
      class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
    />
  </div>

  <!-- RPD Limit -->
  <div>
    <label for="rpd-limit" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">
      RPD Limit
    </label>
    <input
      id="rpd-limit"
      type="number"
      min="1"
      max="500000"
      bind:value={rpdLimit}
      required
      class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
    />
  </div>

  <!-- Priority -->
  <div>
    <label for="priority" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]" title="0 is highest priority">
      Priority (P0-P5)
    </label>
    <input
      id="priority"
      type="number"
      min="0"
      max="10"
      bind:value={priority}
      required
      class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
    />
  </div>
</div>
