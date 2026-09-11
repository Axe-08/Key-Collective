<script lang="ts">
  import { type Microdollars, formatMicrodollars } from '../types';

  export interface ProviderMatrixItem {
    readonly provider: 'gemini' | 'groq' | 'cerebras' | 'deepseek';
    readonly name: string;
    readonly model: string;
    readonly activeKeys: number;
    readonly healthyKeys: number;
    readonly rateLimitedKeys: number;
    readonly rpmLimit: number;
    readonly currentRpm: number;
    readonly status: 'healthy' | 'degraded' | 'tripped';
  }

  let {
    clusterRpmCurrent = 182,
    clusterRpmMax = 450,
    tokenVelocityTpm = 94200,
    tokenVelocityMaxTpm = 300000,
    spendRateMicrodollarsPerHour = 210000, // 210,000 µ$/hr ($0.21/hr)
    upstreamLatencyMs = 138,
    rotationFairnessScore = 98.6,
    providers = [
      {
        provider: 'gemini',
        name: 'Google Gemini Flash',
        model: 'gemini-1.5-flash-latest',
        activeKeys: 12,
        healthyKeys: 11,
        rateLimitedKeys: 1,
        rpmLimit: 180,
        currentRpm: 78,
        status: 'healthy',
      },
      {
        provider: 'groq',
        name: 'Groq LLaMA 3.3',
        model: 'llama-3.3-70b-versatile',
        activeKeys: 8,
        healthyKeys: 8,
        rateLimitedKeys: 0,
        rpmLimit: 240,
        currentRpm: 84,
        status: 'healthy',
      },
      {
        provider: 'cerebras',
        name: 'Cerebras Inference',
        model: 'llama3.1-8b',
        activeKeys: 4,
        healthyKeys: 4,
        rateLimitedKeys: 0,
        rpmLimit: 240,
        currentRpm: 16,
        status: 'healthy',
      },
      {
        provider: 'deepseek',
        name: 'DeepSeek Reasoner',
        model: 'deepseek-reasoner',
        activeKeys: 2,
        healthyKeys: 2,
        rateLimitedKeys: 0,
        rpmLimit: 60,
        currentRpm: 4,
        status: 'healthy',
      },
    ],
  }: {
    clusterRpmCurrent?: number;
    clusterRpmMax?: number;
    tokenVelocityTpm?: number;
    tokenVelocityMaxTpm?: number;
    spendRateMicrodollarsPerHour?: Microdollars;
    upstreamLatencyMs?: number;
    rotationFairnessScore?: number;
    providers?: ProviderMatrixItem[];
  } = $props();

  // SVG circular dial parameters (radius = 38, circumference ≈ 238.76)
  const RADIUS = 38;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  function calculateDashOffset(current: number, max: number): number {
    if (max <= 0) return CIRCUMFERENCE;
    const ratio = Math.min(1, Math.max(0, current / max));
    return CIRCUMFERENCE * (1 - ratio);
  }

  let rpmPercentage = $derived(Math.round((clusterRpmCurrent / clusterRpmMax) * 100));
  let tpmPercentage = $derived(Math.round((tokenVelocityTpm / tokenVelocityMaxTpm) * 100));
  let spendPerHourUsd = $derived(formatMicrodollars(spendRateMicrodollarsPerHour));
</script>

<div class="space-y-6">
  <!-- Section Title -->
  <div class="flex items-center justify-between">
    <div class="space-y-0.5">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[20px]" data-icon="speed">speed</span>
        <h2 class="text-headline-sm font-headline-sm font-semibold text-on-surface">Velocity Dials &amp; Cluster Throughput</h2>
      </div>
      <p class="text-body-sm font-body-sm text-on-surface-variant">
        Real-time telemetry measuring edge request velocity, upstream token consumption, and rotation fairness across active isolates.
      </p>
    </div>
    <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high border border-outline-variant/30 text-label-sm font-mono text-secondary">
      <span class="w-2 h-2 rounded-full bg-secondary status-pulse shadow-[0_0_8px_#4edea3]"></span>
      <span>1s Sliding Window</span>
    </div>
  </div>

  <!-- 4 Main Velocity Dials Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <!-- DIAL 1: Cluster RPM Throughput -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col items-center justify-between text-center relative overflow-hidden group hover:border-primary/40 transition-all">
      <div class="w-full flex items-center justify-between text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-mono uppercase tracking-wider">
          <span class="material-symbols-outlined text-[15px] text-primary">dynamic_form</span>
          Cluster RPM
        </span>
        <span class="font-mono text-primary font-bold">{rpmPercentage}%</span>
      </div>

      <!-- Circular SVG Gauge -->
      <div class="relative my-3 flex items-center justify-center">
        <svg class="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
          <!-- Background Track -->
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="currentColor"
            stroke-width="7"
            class="text-surface-container-highest"
            fill="transparent"
          />
          <!-- Active Progress -->
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="url(#rpmGradient)"
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={calculateDashOffset(clusterRpmCurrent, clusterRpmMax)}
            fill="transparent"
            class="transition-all duration-700 ease-out"
          />
          <defs>
            <linearGradient id="rpmGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#4edea3" />
              <stop offset="60%" stop-color="#8083ff" />
              <stop offset="100%" stop-color="#c0c1ff" />
            </linearGradient>
          </defs>
        </svg>

        <!-- Center Readout -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-[22px] font-bold font-mono text-on-surface tracking-tight leading-none">
            {clusterRpmCurrent}
          </span>
          <span class="text-[10px] font-mono text-outline uppercase tracking-wider mt-0.5">
            / {clusterRpmMax} RPM
          </span>
        </div>
      </div>

      <div class="w-full pt-2 border-t border-outline-variant/20 flex justify-between text-[11px] font-mono text-on-surface-variant">
        <span>Headroom</span>
        <span class="text-secondary font-semibold">{Math.max(0, clusterRpmMax - clusterRpmCurrent)} RPM</span>
      </div>
    </div>

    <!-- DIAL 2: Token Velocity (TPM) -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col items-center justify-between text-center relative overflow-hidden group hover:border-secondary/40 transition-all">
      <div class="w-full flex items-center justify-between text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-mono uppercase tracking-wider">
          <span class="material-symbols-outlined text-[15px] text-secondary">token</span>
          Token Velocity
        </span>
        <span class="font-mono text-secondary font-bold">{tpmPercentage}%</span>
      </div>

      <!-- Circular SVG Gauge -->
      <div class="relative my-3 flex items-center justify-center">
        <svg class="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="currentColor"
            stroke-width="7"
            class="text-surface-container-highest"
            fill="transparent"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="url(#tpmGradient)"
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={calculateDashOffset(tokenVelocityTpm, tokenVelocityMaxTpm)}
            fill="transparent"
            class="transition-all duration-700 ease-out"
          />
          <defs>
            <linearGradient id="tpmGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#00a572" />
              <stop offset="70%" stop-color="#4edea3" />
              <stop offset="100%" stop-color="#6ffbbe" />
            </linearGradient>
          </defs>
        </svg>

        <!-- Center Readout -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-[20px] font-bold font-mono text-on-surface tracking-tight leading-none">
            {(tokenVelocityTpm / 1000).toFixed(1)}k
          </span>
          <span class="text-[10px] font-mono text-outline uppercase tracking-wider mt-0.5">
            TPM Speed
          </span>
        </div>
      </div>

      <div class="w-full pt-2 border-t border-outline-variant/20 flex justify-between text-[11px] font-mono text-on-surface-variant">
        <span>Window Cap</span>
        <span class="text-on-surface font-semibold">{(tokenVelocityMaxTpm / 1000).toFixed(0)}k TPM</span>
      </div>
    </div>

    <!-- DIAL 3: Microdollar Cost Trajectory -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col items-center justify-between text-center relative overflow-hidden group hover:border-amber-500/40 transition-all">
      <div class="w-full flex items-center justify-between text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-mono uppercase tracking-wider">
          <span class="material-symbols-outlined text-[15px] text-amber-400">price_change</span>
          Cost Velocity
        </span>
        <span class="font-mono text-amber-300 font-bold">µ$ RATE</span>
      </div>

      <!-- Circular SVG Gauge -->
      <div class="relative my-3 flex items-center justify-center">
        <svg class="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="currentColor"
            stroke-width="7"
            class="text-surface-container-highest"
            fill="transparent"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="url(#spendGradient)"
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={calculateDashOffset(spendRateMicrodollarsPerHour, 1000000)}
            fill="transparent"
            class="transition-all duration-700 ease-out"
          />
          <defs>
            <linearGradient id="spendGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ca8100" />
              <stop offset="60%" stop-color="#ffb95f" />
              <stop offset="100%" stop-color="#ffddb8" />
            </linearGradient>
          </defs>
        </svg>

        <!-- Center Readout -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-[18px] font-bold font-mono text-amber-300 tracking-tight leading-none">
            {spendPerHourUsd}
          </span>
          <span class="text-[10px] font-mono text-outline uppercase tracking-wider mt-0.5">
            Per Hour
          </span>
        </div>
      </div>

      <div class="w-full pt-2 border-t border-outline-variant/20 flex justify-between text-[11px] font-mono text-on-surface-variant">
        <span>Fixed-Point</span>
        <span class="text-amber-300 font-mono">{spendRateMicrodollarsPerHour.toLocaleString()} µ$/h</span>
      </div>
    </div>

    <!-- DIAL 4: Upstream p95 Latency -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col items-center justify-between text-center relative overflow-hidden group hover:border-cyan-500/40 transition-all">
      <div class="w-full flex items-center justify-between text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-mono uppercase tracking-wider">
          <span class="material-symbols-outlined text-[15px] text-cyan-400">timelapse</span>
          p95 Latency
        </span>
        <span class="font-mono text-cyan-300 font-bold">&lt; 250ms SLA</span>
      </div>

      <!-- Circular SVG Gauge -->
      <div class="relative my-3 flex items-center justify-center">
        <svg class="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="currentColor"
            stroke-width="7"
            class="text-surface-container-highest"
            fill="transparent"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke="url(#latencyGradient)"
            stroke-width="7"
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={calculateDashOffset(upstreamLatencyMs, 300)}
            fill="transparent"
            class="transition-all duration-700 ease-out"
          />
          <defs>
            <linearGradient id="latencyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#06b6d4" />
              <stop offset="70%" stop-color="#22d3ee" />
              <stop offset="100%" stop-color="#67e8f9" />
            </linearGradient>
          </defs>
        </svg>

        <!-- Center Readout -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-[22px] font-bold font-mono text-cyan-300 tracking-tight leading-none">
            {upstreamLatencyMs}ms
          </span>
          <span class="text-[10px] font-mono text-outline uppercase tracking-wider mt-0.5">
            Roundtrip
          </span>
        </div>
      </div>

      <div class="w-full pt-2 border-t border-outline-variant/20 flex justify-between text-[11px] font-mono text-on-surface-variant">
        <span>Edge Isolate</span>
        <span class="text-secondary font-semibold">12ms (SIN-01)</span>
      </div>
    </div>
  </div>

  <!-- Upstream Provider Matrix & Rotation Fairness Score -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <!-- Rotation Fairness Gauge (1 column) -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col justify-between">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-secondary text-[20px]" data-icon="balance">balance</span>
            <span class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[15px]">Rotation Fairness Score</span>
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary/10 text-secondary border border-secondary/20 uppercase font-semibold">
            Balanced
          </span>
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant text-[12px]">
          Sliding-window CSPRNG round-robin distributing incoming requests across all valid AES-256-GCM encrypted credentials.
        </p>
      </div>

      <div class="py-4 space-y-3">
        <div class="flex items-baseline justify-between">
          <span class="text-[32px] font-bold font-mono text-secondary tracking-tight">
            {rotationFairnessScore}%
          </span>
          <span class="text-label-sm font-mono text-outline">
            Gini Index: 0.014 (Ideal)
          </span>
        </div>
        <div class="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
          <div
            class="bg-gradient-to-r from-secondary via-primary to-primary-fixed h-full rounded-full transition-all duration-700"
            style="width: {rotationFairnessScore}%;"
          ></div>
        </div>
      </div>

      <div class="p-3 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 text-[11px] font-mono text-on-surface-variant flex items-center justify-between">
        <span class="flex items-center gap-1.5 text-secondary">
          <span class="w-2 h-2 rounded-full bg-secondary"></span>
          Zero Starvation Guard
        </span>
        <span class="text-outline">Max deviation: ±2.1%</span>
      </div>
    </div>

    <!-- Upstream Key Pool Matrix Table (2 columns) -->
    <div class="lg:col-span-2 specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 flex flex-col justify-between">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-[20px]" data-icon="vpn_key">vpn_key</span>
          <span class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[15px]">Upstream Provider Key Matrix</span>
        </div>
        <span class="text-label-sm font-mono text-outline">
          {providers.reduce((acc, p) => acc + p.activeKeys, 0)} Total Keys Active (AES-256-GCM)
        </span>
      </div>

      <!-- Providers Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {#each providers as prov}
          <div class="p-3 rounded-lg bg-surface-container-lowest/70 border border-outline-variant/20 flex flex-col justify-between gap-2 hover:border-outline-variant/40 transition-colors">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="font-semibold text-on-surface text-[13px]">{prov.name}</span>
                  {#if prov.status === 'healthy'}
                    <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                  {:else if prov.status === 'degraded'}
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  {:else}
                    <span class="w-1.5 h-1.5 rounded-full bg-error"></span>
                  {/if}
                </div>
                <span class="font-mono text-[10px] text-outline">{prov.model}</span>
              </div>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                {prov.currentRpm} / {prov.rpmLimit} RPM
              </span>
            </div>

            <!-- Mini Progress Bar -->
            <div class="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500 {prov.currentRpm / prov.rpmLimit > 0.8 ? 'bg-amber-400' : 'bg-primary'}"
                style="width: {Math.min(100, Math.round((prov.currentRpm / prov.rpmLimit) * 100))}%;"
              ></div>
            </div>

            <!-- Footer Stats -->
            <div class="flex items-center justify-between text-[10px] font-mono text-on-surface-variant pt-0.5">
              <span>{prov.healthyKeys} healthy • {prov.rateLimitedKeys} cooldown</span>
              <span class="text-secondary">{prov.activeKeys} keys live</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
