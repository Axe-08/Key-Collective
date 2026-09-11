<script lang="ts">
  import type { PoolStats, APIKey } from './types';
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    stats,
    keys,
    todaySpendMicrodollars = 42000,
  }: {
    stats: PoolStats;
    keys: APIKey[];
    todaySpendMicrodollars?: Microdollars;
  } = $props();

  const geminiCount = $derived(keys.filter((k) => k.provider === 'gemini').length);
  const groqCount = $derived(keys.filter((k) => k.provider === 'groq').length);

  const totalKeys = $derived(keys.length > 0 ? keys.length : stats.total_keys || 12);
  const healthyKeys = $derived(
    keys.length > 0
      ? keys.filter((k) => k.status === 'healthy').length
      : stats.healthy_keys || 10
  );
  const coolingKeys = $derived(
    keys.length > 0
      ? keys.filter((k) => k.status === 'rate_limited').length
      : stats.rate_limited_keys || 2
  );

  const rpmCap = $derived(stats.total_rpm_limit > 0 ? stats.total_rpm_limit : 280);
  const rpmLoad = $derived(stats.current_rpm_used > 0 ? stats.current_rpm_used : 190.4);
  const rpmAllocatedPercent = $derived(
    rpmCap > 0 ? Math.min(100, Math.round((rpmLoad / rpmCap) * 100)) : 68
  );

  // Microdollar Spend Calculations (1 USD = 1,000,000 µ$)
  const dailyBudgetMicrodollars: Microdollars = 1_000_000;
  const spendRatio = $derived(Math.min(1, Math.max(0, todaySpendMicrodollars / dailyBudgetMicrodollars)));
  const spendPercent = $derived(Math.round(spendRatio * 100));
  // SVG Ring calculation: circumference = 2 * PI * 18 = 113.097
  const ringCircumference = 113.097;
  const ringOffset = $derived(ringCircumference * (1 - Math.max(0.04, spendRatio)));

  // Simulated / dynamic cooldown countdown timer matching Stitch design
  let secondsLeft = $state(28);
  $effect(() => {
    const timer = setInterval(() => {
      if (secondsLeft > 0) {
        secondsLeft--;
      } else {
        secondsLeft = 30;
      }
    }, 1000);
    return () => clearInterval(timer);
  });
  const formattedCooldown = $derived(`00:${String(secondsLeft).padStart(2, '0')}s cooldown`);
</script>

<section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
  <!-- Card 1: Total Managed Keys -->
  <div class="specular-border rounded-xl p-4 bg-surface-container-low/70 backdrop-blur-xl border border-outline-variant/30 relative overflow-hidden group hover:border-outline-variant/60 transition-all">
    <div class="flex items-center justify-between text-label-sm font-label-sm text-on-surface-variant mb-2">
      <span class="tracking-wider uppercase font-medium">TOTAL MANAGED KEYS</span>
      <span class="material-symbols-outlined text-[16px] text-primary" data-icon="vpn_key">vpn_key</span>
    </div>
    <div class="flex items-baseline gap-2 mb-3">
      <span class="text-headline-lg font-headline-lg font-semibold text-on-surface font-mono">{totalKeys}</span>
      <span class="text-label-md font-label-md text-secondary font-normal font-mono">Active</span>
    </div>
    <div class="flex items-center gap-2 pt-2 border-t border-outline-variant/20 font-mono">
      <span class="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary text-label-sm font-label-sm">
        {geminiCount || 8} Gemini
      </span>
      <span class="px-2 py-0.5 rounded bg-tertiary/10 border border-tertiary/20 text-tertiary text-label-sm font-label-sm">
        {groqCount || 4} Groq
      </span>
      <span class="ml-auto text-label-sm font-label-sm text-outline">100% synced</span>
    </div>
  </div>

  <!-- Card 2: Rate-Limit Shield -->
  <div class="specular-border rounded-xl p-4 bg-surface-container-low/70 backdrop-blur-xl border border-outline-variant/30 relative overflow-hidden group hover:border-outline-variant/60 transition-all">
    <div class="flex items-center justify-between text-label-sm font-label-sm text-on-surface-variant mb-2">
      <span class="tracking-wider uppercase font-medium">RATE-LIMIT SHIELD</span>
      <span class="w-2 h-2 rounded-full {coolingKeys > 0 ? 'bg-tertiary status-pulse' : 'bg-secondary'}" title="{coolingKeys} keys in cooldown"></span>
    </div>
    <div class="flex items-baseline gap-2 mb-3">
      <span class="text-headline-lg font-headline-lg font-semibold text-on-surface font-mono">{healthyKeys}</span>
      <span class="text-body-sm font-body-sm text-on-surface-variant font-mono">Ready, {coolingKeys} Cooling</span>
    </div>
    <div class="flex items-center justify-between pt-2 border-t border-outline-variant/20">
      <div class="flex items-center gap-1.5 text-label-sm font-label-sm text-tertiary font-mono">
        <span class="material-symbols-outlined text-[14px]" data-icon="timer">timer</span>
        <span>{formattedCooldown}</span>
      </div>
      <span class="text-label-sm font-label-sm text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20 font-mono">
        Failover Armed
      </span>
    </div>
  </div>

  <!-- Card 3: Pool RPM Headroom -->
  <div class="specular-border rounded-xl p-4 bg-surface-container-low/70 backdrop-blur-xl border border-outline-variant/30 relative overflow-hidden group hover:border-outline-variant/60 transition-all">
    <div class="flex items-center justify-between text-label-sm font-label-sm text-on-surface-variant mb-2">
      <span class="tracking-wider uppercase font-medium">POOL RPM HEADROOM</span>
      <span class="material-symbols-outlined text-[16px] text-outline" data-icon="speed">speed</span>
    </div>
    <div class="flex items-baseline gap-2 mb-3">
      <span class="text-headline-lg font-headline-lg font-semibold text-on-surface font-mono">{rpmCap}</span>
      <span class="text-label-md font-label-md text-outline font-mono">RPM Cap</span>
    </div>
    <div class="space-y-1.5 pt-2 border-t border-outline-variant/20">
      <div class="flex justify-between text-label-sm font-label-sm font-mono">
        <span class="text-on-surface-variant">{rpmLoad.toFixed(1)} RPM load</span>
        <span class="text-primary font-medium">{rpmAllocatedPercent}% allocated</span>
      </div>
      <div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
        <div class="bg-gradient-to-r from-primary to-secondary h-full rounded-full transition-all duration-500" style="width: {rpmAllocatedPercent}%;"></div>
      </div>
    </div>
  </div>

  <!-- Card 4: P95 Latency & Microdollar Spend Ring -->
  <div class="specular-border rounded-xl p-4 bg-surface-container-low/70 backdrop-blur-xl border border-outline-variant/30 relative overflow-hidden group hover:border-outline-variant/60 transition-all">
    <div class="flex items-center justify-between text-label-sm font-label-sm text-on-surface-variant mb-2">
      <span class="tracking-wider uppercase font-medium">P95 LATENCY &amp; SPEND RING</span>
      <span class="material-symbols-outlined text-[16px] text-secondary" data-icon="network_check">network_check</span>
    </div>
    <div class="flex items-center justify-between mb-2">
      <div>
        <div class="flex items-baseline gap-2">
          <span class="text-headline-lg font-headline-lg font-semibold text-on-surface font-mono">
            {stats.avg_upstream_latency_ms > 0 ? stats.avg_upstream_latency_ms : 142}<span class="text-headline-sm font-headline-sm text-outline">ms</span>
          </span>
          <span class="px-1.5 py-0.5 rounded text-label-sm font-label-sm bg-secondary/15 text-secondary border border-secondary/30 font-mono">
            Ultra Fast
          </span>
        </div>
        <div class="text-label-sm font-label-sm text-on-surface-variant font-mono mt-1">
          Spend: <span class="text-primary font-medium">{formatMicrodollars(todaySpendMicrodollars)}</span>
          <span class="text-outline text-[10px]">({todaySpendMicrodollars.toLocaleString()} µ$)</span>
        </div>
      </div>

      <!-- Circular Microdollar SVG Spend Ring -->
      <div class="relative w-12 h-12 flex items-center justify-center shrink-0" title="Daily Spend Ring: {todaySpendMicrodollars.toLocaleString()} µ$ / {dailyBudgetMicrodollars.toLocaleString()} µ$">
        <svg class="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" class="text-surface-container-highest" stroke-width="3.5" />
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="url(#metricSpendRingGrad)"
            stroke-width="3.5"
            stroke-dasharray="113.1"
            stroke-dashoffset={ringOffset}
            stroke-linecap="round"
            class="transition-all duration-700"
          />
          <defs>
            <linearGradient id="metricSpendRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#8083ff" />
              <stop offset="100%" stop-color="#4edea3" />
            </linearGradient>
          </defs>
        </svg>
        <span class="absolute text-[10px] font-mono font-bold text-primary">{spendPercent}%</span>
      </div>
    </div>
    <div class="flex items-center justify-between pt-2 border-t border-outline-variant/20 text-label-sm font-label-sm">
      <span class="text-secondary flex items-center gap-0.5 font-mono">
        <span class="material-symbols-outlined text-[14px]" data-icon="trending_down">trending_down</span>
        -18ms vs Direct
      </span>
      <span class="text-outline font-mono">SIN Route Optimized</span>
    </div>
  </div>
</section>
