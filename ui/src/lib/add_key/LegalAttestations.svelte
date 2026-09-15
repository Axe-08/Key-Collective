<script lang="ts">
  let {
    attestK1 = $bindable(),
    attestK2 = $bindable(),
  }: {
    attestK1: boolean;
    attestK2: boolean;
  } = $props();
</script>

<div class="space-y-2 mt-4 p-3 rounded-lg bg-slate-900/50 border border-white/5">
  <span class="block text-slate-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
    Legal Attestations
  </span>
  <label class="flex items-start gap-2.5 cursor-pointer group">
    <div class="relative flex items-center justify-center mt-0.5">
      <input type="checkbox" bind:checked={attestK1} class="peer sr-only" required />
      <div class="w-4 h-4 rounded border border-slate-600 bg-slate-950 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-all"></div>
      <svg class="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <span class="text-[10px] text-slate-300 leading-tight group-hover:text-slate-200">
      [K1] I certify this key has no billing account attached
    </span>
  </label>
  <label class="flex items-start gap-2.5 cursor-pointer group">
    <div class="relative flex items-center justify-center mt-0.5">
      <input type="checkbox" bind:checked={attestK2} class="peer sr-only" required />
      <div class="w-4 h-4 rounded border border-slate-600 bg-slate-950 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-all"></div>
      <svg class="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <span class="text-[10px] text-slate-300 leading-tight group-hover:text-slate-200">
      [K2] I am the authorized creator of this key
    </span>
  </label>
</div>
