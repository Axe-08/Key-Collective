<script lang="ts">
  import type { ProviderKey, CircuitState, ProviderCircuitOverridePayload } from './CircuitBreakerControls.svelte';

  let {
    circuits,
    onCircuitOverride,
  }: {
    circuits: Record<ProviderKey, CircuitState>;
    onCircuitOverride?: (payload: ProviderCircuitOverridePayload) => void;
  } = $props();

  const providerNames: Record<ProviderKey, { name: string; model: string }> = {
    gemini: { name: 'Google Gemini Flash', model: 'gemini-3.5-flash' },
    groq: { name: 'Groq Cloud', model: 'openai/gpt-oss-120b' },
    cerebras: { name: 'Cerebras Inference', model: 'llama3.1-8b' },
    deepseek: { name: 'DeepSeek Reasoner', model: 'deepseek-reasoner' },
  };

  function toggleCircuit(provider: ProviderKey) {
    if (!onCircuitOverride) return;
    const currentState = circuits[provider]?.state ?? 'NORMAL';
    const newState = currentState === 'NORMAL' ? 'TRIPPED' : 'NORMAL';
    onCircuitOverride({
      provider,
      state: newState,
      reason: `Admin manual toggle to ${newState}`,
    });
  }
</script>

<div class="space-y-4 font-mono text-xs" data-testid="admin-providers-view">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    {#each (Object.keys(circuits) as ProviderKey[]) as prov}
      {@const c = circuits[prov]}
      {@const meta = providerNames[prov]}
      {@const isTripped = c?.state === 'TRIPPED'}

      <div class="rounded-xl border {isTripped ? 'border-error/40 bg-error/5' : 'border-outline-variant/30 bg-surface-container-low/70'} p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-semibold text-sm text-on-surface">{meta.name}</div>
            <div class="text-[11px] text-outline">{meta.model}</div>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase {isTripped ? 'bg-error/20 text-error border border-error/40' : 'bg-secondary/20 text-secondary border border-secondary/40'}">
            {c?.state ?? 'NORMAL'}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant/15 text-[11px]">
          <div>
            <span class="text-outline">Failures:</span>
            <span class="text-on-surface font-semibold ml-1">{c?.failureCount ?? 0} / {c?.failureThreshold ?? 5}</span>
          </div>
          <div>
            <span class="text-outline">Latency:</span>
            <span class="text-on-surface font-semibold ml-1">{c?.avgLatencyMs ?? 0}ms</span>
          </div>
        </div>

        <div class="pt-2 flex justify-end">
          <button
            type="button"
            onclick={() => toggleCircuit(prov)}
            class="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors {isTripped ? 'bg-secondary/20 hover:bg-secondary/30 text-secondary border border-secondary/40' : 'bg-error/20 hover:bg-error/30 text-error border border-error/40'}"
          >
            {isTripped ? 'Reset to NORMAL' : 'Trip Circuit Override'}
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
