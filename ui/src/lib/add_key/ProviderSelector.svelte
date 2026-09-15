<script lang="ts">
  import type { Provider } from '../types';

  let {
    provider = $bindable(),
    onSelect,
  }: {
    provider: Provider;
    onSelect: (provider: Provider) => void;
  } = $props();
</script>

<div>
  <span class="block text-slate-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
    Target Upstream Provider
  </span>
  <div class="grid grid-cols-2 gap-3">
    <button
      type="button"
      onclick={() => onSelect('gemini')}
      class="flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer {provider === 'gemini'
        ? 'bg-blue-950/40 border-blue-500/50 text-blue-200 shadow-md shadow-blue-950/40 ring-1 ring-blue-500/40'
        : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'}"
    >
      <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
        </svg>
      </div>
      <div>
        <div class="font-bold text-white text-xs">Google Gemini</div>
        <div class="text-[10px] text-slate-400">15 RPM / 1.5K RPD default</div>
      </div>
    </button>

    <button
      type="button"
      onclick={() => onSelect('groq')}
      class="flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer {provider === 'groq'
        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200 shadow-md shadow-amber-950/40 ring-1 ring-amber-500/40'
        : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'}"
    >
      <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
      <div>
        <div class="font-bold text-white text-xs">Groq Cloud</div>
        <div class="text-[10px] text-slate-400">30 RPM / 14.4K RPD default</div>
      </div>
    </button>
  </div>
</div>
