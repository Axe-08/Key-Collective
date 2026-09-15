<script lang="ts">
  let {
    isBuilderOrHigher,
    isProbationary,
  }: {
    isBuilderOrHigher: boolean;
    isProbationary: boolean;
  } = $props();
</script>

<!-- Section 3: Real-time 5-Layer Anti-Sybil Verification Score Breakdown -->
<div class="space-y-3 pt-2">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-indigo-400 text-lg">fact_check</span>
      <h3 class="text-xs font-mono uppercase tracking-widest text-white/80 font-bold">
        5-Layer Anti-Sybil Verification Matrix
      </h3>
    </div>
    <span class="text-[11px] font-mono {isBuilderOrHigher ? 'text-emerald-400' : 'text-amber-400'} flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full {isBuilderOrHigher ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse"></span>
      <span>{isBuilderOrHigher ? '5 of 5 Checks Passed' : isProbationary ? '3 of 5 Checks Passed (GitHub Pending)' : 'Awaiting Proofs'}</span>
    </span>
  </div>

  <!-- 5 Verification Layers Grid (Matches screen3 HTML spec) -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
    <!-- Layer 1: GitHub Age -->
    <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-white/40 uppercase">Layer 01</span>
          <span class="text-[10px] font-mono font-semibold {isBuilderOrHigher ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'} px-1.5 py-0.5 rounded border">
            {isBuilderOrHigher ? 'PASS' : 'PENDING'}
          </span>
        </div>
        <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-xs text-white/60">schedule</span>
          <span>GitHub Age</span>
        </div>
        <p class="text-[11px] text-white/50 leading-tight">Requirement: &gt;90 days</p>
      </div>
      <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono {isBuilderOrHigher ? 'text-emerald-300/90' : 'text-white/40'} font-medium">
        {isBuilderOrHigher ? 'Active: 420 days' : 'Awaiting OAuth'}
      </div>
    </div>

    <!-- Layer 2: Commit Frequency -->
    <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-white/40 uppercase">Layer 02</span>
          <span class="text-[10px] font-mono font-semibold {isBuilderOrHigher ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'} px-1.5 py-0.5 rounded border">
            {isBuilderOrHigher ? 'PASS' : 'PENDING'}
          </span>
        </div>
        <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-xs text-white/60">commit</span>
          <span>Commit Frequency</span>
        </div>
        <p class="text-[11px] text-white/50 leading-tight">Requirement: &gt;15 commits/yr</p>
      </div>
      <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono {isBuilderOrHigher ? 'text-emerald-300/90' : 'text-white/40'} font-medium">
        {isBuilderOrHigher ? '84 public commits' : 'Awaiting OAuth'}
      </div>
    </div>

    <!-- Layer 3: Turnstile Nonce -->
    <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-white/40 uppercase">Layer 03</span>
          <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
        </div>
        <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-xs text-white/60">smart_toy</span>
          <span>Turnstile Nonce</span>
        </div>
        <p class="text-[11px] text-white/50 leading-tight">Bot challenge check</p>
      </div>
      <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
        Challenge solved
      </div>
    </div>

    <!-- Layer 4: Mail Detection -->
    <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-white/40 uppercase">Layer 04</span>
          <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
        </div>
        <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-xs text-white/60">mail_lock</span>
          <span>Mail Detection</span>
        </div>
        <p class="text-[11px] text-white/50 leading-tight">Anti-disposable MX filter</p>
      </div>
      <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
        Clean enterprise/pers.
      </div>
    </div>

    <!-- Layer 5: IP & Velocity -->
    <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-white/40 uppercase">Layer 05</span>
          <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
        </div>
        <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-xs text-white/60">speed</span>
          <span>IP &amp; Velocity</span>
        </div>
        <p class="text-[11px] text-white/50 leading-tight">Subnet rate correlation</p>
      </div>
      <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
        Clean IP (1 req/min)
      </div>
    </div>
  </div>
</div>
