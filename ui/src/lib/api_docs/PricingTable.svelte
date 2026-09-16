<script lang="ts">
  import type { ModelPricingItem } from './types';

  interface Props {
    modelsData?: ModelPricingItem[] | null;
    pricingFilter?: 'active' | 'all';
    onFilterChange?: (filter: 'active' | 'all') => void;
  }

  let { modelsData, pricingFilter = 'active', onFilterChange }: Props = $props();

  type ProviderKey = 'all' | 'google' | 'groq' | 'cerebras' | 'sambanova' | 'deepseek' | 'openai';
  let selectedProvider = $state<ProviderKey>('all');

  interface FreeTierModel {
    id: string;
    provider: ProviderKey;
    providerName: string;
    description: string;
    rpm: number;
    rpd: number;
    tpm: string;
    contextWindow: string;
    latency: string;
    capabilities: string[];
    poolStatus: 'ACTIVE' | 'STANDBY' | 'COMMUNITY';
    tier: string;
  }

  const FREE_TIER_CATALOG: FreeTierModel[] = [
    // Google Gemini
    {
      id: 'gemini-3.8-flash',
      provider: 'google',
      providerName: 'Google Gemini',
      description: 'Next-gen flagship multimodal model with ultra-fast edge reasoning and 1M context token buffer.',
      rpm: 15,
      rpd: 1500,
      tpm: '1M',
      contextWindow: '1,048,576 tokens',
      latency: '~180ms',
      capabilities: ['Vision', 'Audio', 'Function Calling', 'Structured JSON'],
      poolStatus: 'ACTIVE',
      tier: 'Tier 1 Priority',
    },
    {
      id: 'gemini-3.5-flash',
      provider: 'google',
      providerName: 'Google Gemini',
      description: 'Fast, cost-effective multimodal workhorse optimized for high throughput API cascades.',
      rpm: 15,
      rpd: 1500,
      tpm: '1M',
      contextWindow: '1,048,576 tokens',
      latency: '~160ms',
      capabilities: ['Vision', 'Tool Calling', 'Structured JSON'],
      poolStatus: 'ACTIVE',
      tier: 'Tier 1 Priority',
    },
    {
      id: 'gemini-3.5-flash-lite',
      provider: 'google',
      providerName: 'Google Gemini',
      description: 'Ultra-lightweight high-frequency model with doubled free RPM rate limits.',
      rpm: 30,
      rpd: 1500,
      tpm: '1M',
      contextWindow: '1,048,576 tokens',
      latency: '~110ms',
      capabilities: ['High RPM', 'Tool Calling', 'JSON Schema'],
      poolStatus: 'ACTIVE',
      tier: 'High Velocity',
    },
    {
      id: 'gemini-2.5-flash',
      provider: 'google',
      providerName: 'Google Gemini',
      description: 'Rock-solid LTS generation for enterprise background jobs and document extraction.',
      rpm: 15,
      rpd: 1500,
      tpm: '1M',
      contextWindow: '1,048,576 tokens',
      latency: '~190ms',
      capabilities: ['Vision', 'Function Calling', 'Code Extraction'],
      poolStatus: 'ACTIVE',
      tier: 'LTS Stable',
    },
    // GroqCloud
    {
      id: 'llama-3.3-70b-versatile',
      provider: 'groq',
      providerName: 'GroqCloud LPU',
      description: 'Frontier 70B open-weights model accelerated on Groq LPU hardware at 350+ tokens/sec.',
      rpm: 30,
      rpd: 14400,
      tpm: '6,000',
      contextWindow: '128,000 tokens',
      latency: '~45ms',
      capabilities: ['Extreme Speed (350 tps)', 'Tool Use', 'Complex Reasoning'],
      poolStatus: 'ACTIVE',
      tier: 'Tier 1 Priority',
    },
    {
      id: 'llama-3.1-8b-instant',
      provider: 'groq',
      providerName: 'GroqCloud LPU',
      description: 'Sub-30ms time-to-first-token lightweight model ideal for interactive chatbots and voice loops.',
      rpm: 30,
      rpd: 14400,
      tpm: '20,000',
      contextWindow: '128,000 tokens',
      latency: '~25ms',
      capabilities: ['Voice Ready (<30ms TTFT)', 'Tool Use', 'JSON Mode'],
      poolStatus: 'ACTIVE',
      tier: 'High Velocity',
    },
    {
      id: 'qwen/qwen3.8-27b',
      provider: 'groq',
      providerName: 'GroqCloud LPU',
      description: 'High-capability multilingual and math-specialized weights with lightning inference.',
      rpm: 30,
      rpd: 14400,
      tpm: '10,000',
      contextWindow: '32,768 tokens',
      latency: '~50ms',
      capabilities: ['Multilingual', 'Code Generation', 'Math'],
      poolStatus: 'ACTIVE',
      tier: 'Tier 2 Secondary',
    },
    // Cerebras Systems
    {
      id: 'llama3.1-70b',
      provider: 'cerebras',
      providerName: 'Cerebras Systems',
      description: 'World-record token generation speeds powered by CS-3 wafer-scale inference engine.',
      rpm: 30,
      rpd: 14400,
      tpm: '60,000',
      contextWindow: '128,000 tokens',
      latency: '~35ms',
      capabilities: ['Wafer Scale (1800 tps)', 'High TPM Quota', 'Coding'],
      poolStatus: 'ACTIVE',
      tier: 'Wafer Scale',
    },
    {
      id: 'llama3.1-8b',
      provider: 'cerebras',
      providerName: 'Cerebras Systems',
      description: 'Ultra-low latency compact model with generous 60,000 TPM free-tier quota ceiling.',
      rpm: 30,
      rpd: 14400,
      tpm: '60,000',
      contextWindow: '8,192 tokens',
      latency: '~20ms',
      capabilities: ['Sub-20ms Latency', 'High Quota', 'Classification'],
      poolStatus: 'ACTIVE',
      tier: 'High Velocity',
    },
    // SambaNova Systems
    {
      id: 'Meta-Llama-3.1-405B-Instruct',
      provider: 'sambanova',
      providerName: 'SambaNova Systems',
      description: 'World-largest 405-billion parameter open model served at full precision on SN40L dataflow chips.',
      rpm: 20,
      rpd: 5000,
      tpm: '30,000',
      contextWindow: '8,192 tokens',
      latency: '~90ms',
      capabilities: ['Frontier 405B Intelligence', 'Deep Reasoning', 'Synthesis'],
      poolStatus: 'ACTIVE',
      tier: 'Frontier Flagship',
    },
    {
      id: 'Meta-Llama-3.1-70B-Instruct',
      provider: 'sambanova',
      providerName: 'SambaNova Systems',
      description: 'Full 16-bit precision 70B parameter inference on reconfigurable dataflow architectures.',
      rpm: 20,
      rpd: 10000,
      tpm: '40,000',
      contextWindow: '16,384 tokens',
      latency: '~65ms',
      capabilities: ['FP16 Full Precision', 'Code Analysis', 'Structured Tools'],
      poolStatus: 'ACTIVE',
      tier: 'Tier 1 Priority',
    },
    // DeepSeek AI
    {
      id: 'deepseek/deepseek-r1-distill-llama-70b',
      provider: 'deepseek',
      providerName: 'DeepSeek AI',
      description: 'Reasoning model fine-tuned with reinforcement learning to generate chain-of-thought tokens.',
      rpm: 20,
      rpd: 5000,
      tpm: '20,000',
      contextWindow: '64,000 tokens',
      latency: '~120ms',
      capabilities: ['Chain-of-Thought Reasoning', 'Self-Correction', 'Math/Logic'],
      poolStatus: 'ACTIVE',
      tier: 'Reasoning Specialist',
    },
    // OpenAI Fallback
    {
      id: 'gpt-4o-mini',
      provider: 'openai',
      providerName: 'OpenAI (Fallback)',
      description: 'Commercial fallback tier when open weights providers exceed simultaneous pool quotas.',
      rpm: 3,
      rpd: 200,
      tpm: '40,000',
      contextWindow: '128,000 tokens',
      latency: '~210ms',
      capabilities: ['Vision', 'Structured Output', 'Enterprise Fallback'],
      poolStatus: 'STANDBY',
      tier: 'Fallback Shield',
    },
  ];

  const filteredCatalog = $derived(
    selectedProvider === 'all'
      ? FREE_TIER_CATALOG
      : FREE_TIER_CATALOG.filter((m) => m.provider === selectedProvider)
  );

  const providerCounts = $derived({
    all: FREE_TIER_CATALOG.length,
    google: FREE_TIER_CATALOG.filter(m => m.provider === 'google').length,
    groq: FREE_TIER_CATALOG.filter(m => m.provider === 'groq').length,
    cerebras: FREE_TIER_CATALOG.filter(m => m.provider === 'cerebras').length,
    sambanova: FREE_TIER_CATALOG.filter(m => m.provider === 'sambanova').length,
    deepseek: FREE_TIER_CATALOG.filter(m => m.provider === 'deepseek').length,
    openai: FREE_TIER_CATALOG.filter(m => m.provider === 'openai').length,
  });
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 specular-top shadow-xl space-y-5">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
    <div>
      <h2 class="text-title-lg font-title-lg font-semibold text-on-surface flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[22px]">hub</span>
        Supported Providers &amp; Free-Tier Models
      </h2>
      <p class="text-body-sm font-body-sm text-outline mt-0.5">
        Zero-cost pooled routing architecture. Inspect which providers we use and what free quotas they provide.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <span class="px-2.5 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-xs font-mono font-medium flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
        100% Free Tiers Pooled
      </span>
    </div>
  </div>

  <!-- Provider Filter Tabs -->
  <div class="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
    <button
      type="button"
      onclick={() => (selectedProvider = 'all')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 {selectedProvider === 'all' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      All Providers ({providerCounts.all})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'google')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'google' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">token</span>
      Google Gemini ({providerCounts.google})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'groq')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'groq' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">bolt</span>
      GroqCloud ({providerCounts.groq})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'cerebras')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'cerebras' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">memory</span>
      Cerebras ({providerCounts.cerebras})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'sambanova')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'sambanova' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">device_hub</span>
      SambaNova ({providerCounts.sambanova})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'deepseek')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'deepseek' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">psychology</span>
      DeepSeek ({providerCounts.deepseek})
    </button>
    <button
      type="button"
      onclick={() => (selectedProvider = 'openai')}
      class="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 {selectedProvider === 'openai' ? 'bg-primary text-on-primary font-bold shadow' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
    >
      <span class="material-symbols-outlined text-[14px]">smart_toy</span>
      OpenAI ({providerCounts.openai})
    </button>
  </div>

  <!-- Models Catalog Table -->
  <div class="overflow-x-auto border border-outline-variant/20 rounded-xl">
    <table class="w-full text-left font-mono text-xs min-w-[760px]">
      <thead>
        <tr class="text-outline uppercase font-label-sm text-[11px] border-b border-outline-variant/20 bg-surface-container-high/40">
          <th class="py-3 px-4">Provider &amp; Model ID</th>
          <th class="py-3 px-4">Free Quota (RPM / RPD)</th>
          <th class="py-3 px-4">Context Window</th>
          <th class="py-3 px-4">Latency</th>
          <th class="py-3 px-4">Key Capabilities</th>
          <th class="py-3 px-4 text-right">Routing Tier</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10 text-on-surface bg-surface-container-lowest/40">
        {#each filteredCatalog as model}
          <tr class="hover:bg-white/[0.03] transition-colors">
            <!-- Model ID & Provider -->
            <td class="py-3 px-4">
              <div class="flex items-center gap-2.5">
                <div class="w-7 h-7 rounded {model.provider === 'google' ? 'bg-primary/10 text-primary border border-primary/20' : model.provider === 'groq' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-secondary/10 text-secondary border border-secondary/20'} flex items-center justify-center shrink-0">
                  <span class="material-symbols-outlined text-[15px]">
                    {model.provider === 'google' ? 'token' : model.provider === 'groq' ? 'bolt' : model.provider === 'cerebras' ? 'memory' : model.provider === 'sambanova' ? 'device_hub' : model.provider === 'deepseek' ? 'psychology' : 'smart_toy'}
                  </span>
                </div>
                <div>
                  <div class="font-bold text-on-surface flex items-center gap-1.5">
                    <span>{model.id}</span>
                  </div>
                  <div class="text-[11px] text-outline font-sans mt-0.5 max-w-xs leading-tight">
                    {model.description}
                  </div>
                </div>
              </div>
            </td>

            <!-- Free Quota Limits -->
            <td class="py-3 px-4">
              <div class="space-y-0.5">
                <div class="font-semibold text-secondary">
                  {model.rpm} RPM <span class="text-outline font-normal">/ {model.rpd.toLocaleString()} RPD</span>
                </div>
                <div class="text-[10px] text-outline">
                  TPM Cap: {model.tpm}
                </div>
              </div>
            </td>

            <!-- Context Window -->
            <td class="py-3 px-4 text-on-surface-variant font-medium">
              {model.contextWindow}
            </td>

            <!-- Latency -->
            <td class="py-3 px-4">
              <span class="font-medium text-emerald-400">{model.latency}</span>
            </td>

            <!-- Capabilities -->
            <td class="py-3 px-4">
              <div class="flex flex-wrap gap-1 max-w-xs">
                {#each model.capabilities as cap}
                  <span class="px-1.5 py-0.5 rounded text-[10px] bg-surface-container border border-outline-variant/30 text-on-surface-variant">
                    {cap}
                  </span>
                {/each}
              </div>
            </td>

            <!-- Routing Tier -->
            <td class="py-3 px-4 text-right">
              <span class="px-2 py-0.5 rounded text-[10px] font-medium border {model.poolStatus === 'ACTIVE' ? 'bg-secondary/10 text-secondary border-secondary/30' : 'bg-surface-container text-outline border-outline-variant/20'}">
                {model.tier}
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
