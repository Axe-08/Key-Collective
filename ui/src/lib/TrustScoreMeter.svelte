<script lang="ts">
  import type { UserTier } from '../../../src/contracts/v3_types';

  let {
    score = 98,
    tier = 'builder',
    size = 160,
    strokeWidth = 8,
  }: {
    score?: number;
    tier?: UserTier | string;
    size?: number;
    strokeWidth?: number;
  } = $props();

  const radius = 64;
  const circumference = 2 * Math.PI * radius; // ~402.12
  const clampedScore = $derived(Math.max(0, Math.min(100, score)));
  const strokeDashoffset = $derived(circumference * (1 - clampedScore / 100));

  const statusColor = $derived(
    clampedScore >= 80
      ? 'text-emerald-400'
      : clampedScore >= 50
        ? 'text-cyan-400'
        : clampedScore >= 30
          ? 'text-amber-400'
          : 'text-rose-400'
  );

  const statusLabel = $derived(
    clampedScore >= 80
      ? 'VERIFIED'
      : clampedScore >= 50
        ? 'EVALUATED'
        : clampedScore >= 30
          ? 'PROBATIONARY'
          : 'SANDBOXED'
  );
</script>

<div class="relative flex items-center justify-center" style="width: {size}px; height: {size}px;">
  <svg class="w-full h-full" viewBox="0 0 160 160">
    <!-- Background Track -->
    <circle
      cx="80"
      cy="80"
      r={radius}
      stroke="currentColor"
      stroke-width={strokeWidth}
      class="text-white/[0.06]"
      fill="transparent"
    />
    <!-- Primary Gradient Glow Arc -->
    <defs>
      <linearGradient id="trustScoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#10b981" />
        <stop offset="50%" stop-color="#06b6d4" />
        <stop offset="100%" stop-color="#6366f1" />
      </linearGradient>
    </defs>
    <!-- Value Arc with dynamic offset -->
    <circle
      cx="80"
      cy="80"
      r={radius}
      stroke="url(#trustScoreGradient)"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      fill="transparent"
      stroke-dasharray={circumference}
      stroke-dashoffset={strokeDashoffset}
      class="circle-progress drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]"
    />
  </svg>

  <!-- Inner Score Content -->
  <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
    <span class="text-4xl font-extrabold text-white tracking-tight font-mono leading-none">
      {clampedScore}
    </span>
    <span class="text-[10px] font-mono text-white/50 tracking-wider mt-1">
      / 100 TRUST
    </span>
    <div class="mt-1 flex items-center gap-1 text-[10px] font-semibold font-mono {statusColor}">
      <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
      </svg>
      <span>{statusLabel}</span>
    </div>
  </div>
</div>
