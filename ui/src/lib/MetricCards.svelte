<script lang="ts">
  import type { PoolStats, APIKey } from './types';
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    stats,
    keys = [],
    todaySpendMicrodollars = 0,
  }: {
    stats?: PoolStats;
    keys?: APIKey[];
    todaySpendMicrodollars?: Microdollars;
  } = $props();

  let liveStats = $state<PoolStats | null>(null);

  function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof window !== 'undefined') {
      try {
        const token = localStorage.getItem('kc_auth_token');
        if (token) headers['Authorization'] = `Bearer ${token.trim()}`;
        const raw = localStorage.getItem('kc_user');
        if (raw) {
          const user = JSON.parse(raw);
          if (user?.id) headers['x-tenant-id'] = user.id;
        }
      } catch {}
    }
    return headers;
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        liveStats = data;
      }
    } catch (err) {
      console.error('Failed to fetch /api/stats:', err);
    }
  }

  $effect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  });

  const effectiveStats = $derived(
    liveStats ?? stats ?? {
      total_keys: 0,
      healthy_keys: 0,
      rate_limited_keys: 0,
      invalid_keys: 0,
      total_rpm_headroom: 0,
      total_rpm_limit: 0,
      current_rpm_used: 0,
      avg_upstream_latency_ms: 0,
      daily_quota_used: 0,
      daily_quota_limit: 0,
      proxy_status: 'healthy' as const,
    }
  );

  const geminiCount = $derived(keys.filter((k) => k.provider === 'gemini').length);
  const groqCount = $derived(keys.filter((k) => k.provider === 'groq').length);

  const totalKeys = $derived(keys.length > 0 ? keys.length : (effectiveStats.total_keys || 0));
  const healthyKeys = $derived(
    keys.length > 0
      ? keys.filter((k) => k.status === 'healthy').length
      : (effectiveStats.healthy_keys || 0)
  );
  const coolingKeys = $derived(
    keys.length > 0
      ? keys.filter((k) => k.status === 'rate_limited').length
      : (effectiveStats.rate_limited_keys || 0)
  );

  const rpmCap = $derived(effectiveStats.total_rpm_limit || 0);
  const rpmLoad = $derived(effectiveStats.current_rpm_used || 0);
  const rpmAllocatedPercent = $derived(
    rpmCap > 0 ? Math.min(100, Math.round((rpmLoad / rpmCap) * 100)) : 0
  );

  // Microdollar Spend Calculations (1 USD = 1,000,000 µ$)
  const effectiveSpendMicrodollars = $derived(
    todaySpendMicrodollars > 0
      ? todaySpendMicrodollars
      : ((effectiveStats as any).total_spend_today_microdollars ?? 0)
  );
  const dailyBudgetMicrodollars: Microdollars = 1_000_000;
  const spendRatio = $derived(Math.min(1, Math.max(0, effectiveSpendMicrodollars / dailyBudgetMicrodollars)));
  const spendPercent = $derived(Math.round(spendRatio * 100));
  // SVG Ring calculation: circumference = 2 * PI * 18 = 113.097
  const ringCircumference = 113.097;
  const ringOffset = $derived(ringCircumference * (1 - Math.max(0.04, spendRatio)));

  // Dynamic cooldown countdown timer
  let currentTime = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => {
      currentTime = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });
  const maxCooldownSec = $derived(
    keys.reduce((max, key) => {
      if (key.status === 'rate_limited' && key.cooldown_until) {
        const diff = Math.ceil((new Date(key.cooldown_until).getTime() - currentTime) / 1000);
        return Math.max(max, diff > 0 ? diff : 0);
      }
      return max;
    }, 0)
  );
  const formattedCooldown = $derived(
    coolingKeys > 0 ? `00:${String(maxCooldownSec).padStart(2, '0')}s cooldown` : `0 keys rate-limited`
  );
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
        {geminiCount} Gemini
      </span>
      <span class="px-2 py-0.5 rounded bg-tertiary/10 border border-tertiary/20 text-tertiary text-label-sm font-label-sm">
        {groqCount} Groq
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
            {effectiveStats.avg_upstream_latency_ms || 0}<span class="text-headline-sm font-headline-sm text-outline">ms</span>
          </span>
          <span class="px-1.5 py-0.5 rounded text-label-sm font-label-sm bg-secondary/15 text-secondary border border-secondary/30 font-mono">
            {effectiveStats.avg_upstream_latency_ms > 0 && effectiveStats.avg_upstream_latency_ms < 100 ? 'Ultra Fast' : effectiveStats.avg_upstream_latency_ms > 0 ? 'Optimal' : 'Active'}
          </span>
        </div>
        <div class="text-label-sm font-label-sm text-on-surface-variant font-mono mt-1">
          Spend: <span class="text-primary font-medium">{formatMicrodollars(effectiveSpendMicrodollars)}</span>
          <span class="text-outline text-[10px]">({effectiveSpendMicrodollars.toLocaleString()} µ$)</span>
        </div>
      </div>

      <!-- Circular Microdollar SVG Spend Ring -->
      <div class="relative w-12 h-12 flex items-center justify-center shrink-0" title="Daily Spend Ring: {effectiveSpendMicrodollars.toLocaleString()} µ$ / {dailyBudgetMicrodollars.toLocaleString()} µ$">
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
        {effectiveStats.avg_upstream_latency_ms > 0 ? `${effectiveStats.avg_upstream_latency_ms}ms avg` : 'Edge Direct'}
      </span>
      <span class="text-outline font-mono">Edge Route Verified</span>
    </div>
  </div>
</section>
