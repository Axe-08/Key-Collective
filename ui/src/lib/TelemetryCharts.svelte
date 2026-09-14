<script lang="ts" module>
  export {
    connectStream,
    updateChart,
    disconnectStream,
    getChartPoints,
    getChartStats,
    resetChart,
    defaultTelemetryChart,
    TelemetryStreamChart,
    type TimeSeriesData,
    type StreamStatus,
    type ChartStats,
    type TelemetryChartOptions,
  } from './TelemetryCharts';
</script>

<script lang="ts">
  import {
    TelemetryStreamChart,
    defaultTelemetryChart,
    type TimeSeriesData,
    type StreamStatus,
    type ChartStats,
  } from './TelemetryCharts';

  let {
    endpoint = '',
    title = 'Real-Time Telemetry Stream',
    unit = 'ms',
    maxPoints = 60,
    autoConnect = true,
    height = 240,
    showControls = true,
    controller,
  }: {
    endpoint?: string;
    title?: string;
    unit?: string;
    maxPoints?: number;
    autoConnect?: boolean;
    height?: number;
    showControls?: boolean;
    controller?: TelemetryStreamChart;
  } = $props();

  // Active chart engine (either custom controller or default singleton)
  const activeChart = $derived(controller ?? defaultTelemetryChart);

  let points = $state<readonly TimeSeriesData[]>([]);
  let stats = $state<ChartStats>({ min: 0, max: 0, avg: 0, current: 0, count: 0 });
  let status = $state<StreamStatus>('idle');
  let activeEndpoint = $state<string | null>(null);
  let isPaused = $state(false);
  let hoveredPoint = $state<TimeSeriesData | null>(null);
  let hoverX = $state(0);
  let hoverY = $state(0);

  // Subscribe to chart data and stream status changes
  $effect(() => {
    const chart = activeChart;
    points = chart.points;
    stats = chart.stats;
    status = chart.status;
    activeEndpoint = chart.endpoint ?? (endpoint || null);

    const unsubData = chart.subscribe((newPoints, newStats) => {
      if (!isPaused) {
        points = newPoints;
        stats = newStats;
      }
    });

    const unsubStatus = chart.subscribeStatus((newStatus, ep) => {
      status = newStatus;
      if (ep) activeEndpoint = ep;
    });

    if (autoConnect && endpoint && chart.status === 'idle') {
      chart.connectStream(endpoint);
    }

    return () => {
      unsubData();
      unsubStatus();
    };
  });

  // SVG dimensions and coordinate calculations
  const svgWidth = 800;
  const svgHeight = $derived(height);
  const paddingLeft = 60;
  const paddingRight = 24;
  const paddingTop = 20;
  const paddingBottom = 36;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = $derived(svgHeight - paddingTop - paddingBottom);

  const yMin = $derived(stats.min === stats.max ? Math.max(0, stats.min - 10) : stats.min);
  const yMax = $derived(stats.min === stats.max ? stats.max + 10 : stats.max);
  const yRange = $derived(yMax - yMin === 0 ? 1 : yMax - yMin);

  // Convert TimeSeriesData to SVG coordinates
  function getCoordinates(pt: TimeSeriesData, index: number, total: number): { x: number; y: number } {
    const xStep = total > 1 ? plotWidth / (total - 1) : plotWidth;
    const x = paddingLeft + index * xStep;
    const norm = (pt.value - yMin) / yRange;
    const y = paddingTop + plotHeight - norm * plotHeight;
    return { x, y: isNaN(y) ? paddingTop + plotHeight / 2 : y };
  }

  const svgPoints = $derived(
    points.map((pt, idx) => getCoordinates(pt, idx, points.length))
  );

  // SVG Line path
  const linePath = $derived.by(() => {
    if (svgPoints.length === 0) return '';
    return svgPoints.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');
  });

  // SVG Area fill path
  const areaPath = $derived.by(() => {
    if (svgPoints.length === 0) return '';
    const firstX = svgPoints[0].x.toFixed(1);
    const lastX = svgPoints[svgPoints.length - 1].x.toFixed(1);
    const bottomY = (paddingTop + plotHeight).toFixed(1);
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  });

  // Y-axis grid ticks (4 levels)
  const yTicks = $derived([
    { label: `${Math.round(yMax)}${unit}`, y: paddingTop },
    { label: `${Math.round(yMin + yRange * 0.66)}${unit}`, y: paddingTop + plotHeight * 0.33 },
    { label: `${Math.round(yMin + yRange * 0.33)}${unit}`, y: paddingTop + plotHeight * 0.66 },
    { label: `${Math.round(yMin)}${unit}`, y: paddingTop + plotHeight },
  ]);

  function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function handleMouseMove(e: MouseEvent) {
    if (svgPoints.length === 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) * (svgWidth / rect.width);
    
    // Find closest data point
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < svgPoints.length; i++) {
      const diff = Math.abs(svgPoints[i].x - relativeX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    if (closestIdx >= 0 && closestIdx < points.length) {
      hoveredPoint = points[closestIdx];
      hoverX = svgPoints[closestIdx].x;
      hoverY = svgPoints[closestIdx].y;
    }
  }

  function handleMouseLeave() {
    hoveredPoint = null;
  }

  function reconnect() {
    if (activeEndpoint) {
      activeChart.connectStream(activeEndpoint);
    }
  }

  function togglePause() {
    isPaused = !isPaused;
  }
</script>

<div class="telemetry-chart-container bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-2xl relative overflow-hidden font-sans text-zinc-100">
  <!-- Header with Title, Stats, and Stream Badge -->
  <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
    <div class="flex items-center gap-3">
      <div class="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <div>
        <h2 class="text-base font-semibold tracking-tight text-white flex items-center gap-2">
          {title}
          <span class="text-xs font-mono text-zinc-500 font-normal">({unit})</span>
        </h2>
        <p class="text-xs text-zinc-400 font-mono truncate max-w-sm">
          {activeEndpoint ? `Endpoint: ${activeEndpoint}` : 'Awaiting stream connection...'}
        </p>
      </div>
    </div>

    <!-- Live Status Pill & Actions -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border
        {status === 'connected' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30' :
         status === 'connecting' ? 'bg-amber-950/40 text-amber-400 border-amber-500/30' :
         status === 'error' ? 'bg-red-950/40 text-red-400 border-red-500/30' :
         'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'}">
        <span class="relative flex h-2 w-2">
          {#if status === 'connected'}
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          {/if}
          <span class="relative inline-flex rounded-full h-2 w-2
            {status === 'connected' ? 'bg-emerald-500' :
             status === 'connecting' ? 'bg-amber-500' :
             status === 'error' ? 'bg-red-500' : 'bg-zinc-500'}"></span>
        </span>
        <span class="uppercase tracking-wider text-[10px]">
          {status === 'connected' ? 'Live Stream' : status}
        </span>
      </div>

      {#if showControls}
        <button
          type="button"
          onclick={togglePause}
          class="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 transition text-zinc-300"
          title={isPaused ? "Resume real-time plotting" : "Pause stream ingestion"}
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          type="button"
          onclick={reconnect}
          class="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 transition text-zinc-300"
          title="Reconnect to stream"
        >
          🔄 Reconnect
        </button>
      {/if}
    </div>
  </div>

  <!-- Metric Badges Row -->
  <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 my-4">
    <div class="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5">
      <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-mono block">Current</span>
      <span class="text-lg font-bold text-white font-mono">{stats.current.toLocaleString()}</span>
      <span class="text-xs text-zinc-500 font-mono ml-0.5">{unit}</span>
    </div>
    <div class="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5">
      <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-mono block">Average</span>
      <span class="text-lg font-bold text-zinc-200 font-mono">{stats.avg.toLocaleString()}</span>
      <span class="text-xs text-zinc-500 font-mono ml-0.5">{unit}</span>
    </div>
    <div class="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5">
      <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-mono block">Minimum</span>
      <span class="text-lg font-bold text-emerald-400 font-mono">{stats.min.toLocaleString()}</span>
      <span class="text-xs text-zinc-500 font-mono ml-0.5">{unit}</span>
    </div>
    <div class="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5">
      <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-mono block">Maximum</span>
      <span class="text-lg font-bold text-amber-400 font-mono">{stats.max.toLocaleString()}</span>
      <span class="text-xs text-zinc-500 font-mono ml-0.5">{unit}</span>
    </div>
    <div class="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5 col-span-2 sm:col-span-1">
      <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-mono block">Points Plotted</span>
      <span class="text-lg font-bold text-cyan-400 font-mono">{stats.count}</span>
      <span class="text-xs text-zinc-500 font-mono ml-0.5">/ {maxPoints}</span>
    </div>
  </div>

  <!-- Real-time Interactive SVG Chart -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative w-full overflow-hidden select-none bg-zinc-900/30 rounded-lg border border-zinc-800/60"
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
  >
    <svg
      class="w-full h-auto block"
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Real-time telemetry stream chart"
    >
      <defs>
        <!-- Area gradient -->
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Horizontal grid lines and Y-axis labels -->
      {#each yTicks as tick}
        <line
          x1={paddingLeft}
          y1={tick.y}
          x2={svgWidth - paddingRight}
          y2={tick.y}
          stroke="#27272a"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
        <text
          x={paddingLeft - 8}
          y={tick.y + 4}
          fill="#71717a"
          font-size="10"
          font-family="monospace"
          text-anchor="end"
        >
          {tick.label}
        </text>
      {/each}

      <!-- Bottom X Axis Line -->
      <line
        x1={paddingLeft}
        y1={paddingTop + plotHeight}
        x2={svgWidth - paddingRight}
        y2={paddingTop + plotHeight}
        stroke="#3f3f46"
        stroke-width="1"
      />

      <!-- Area fill under line -->
      {#if areaPath}
        <path d={areaPath} fill="url(#chartGradient)" />
      {/if}

      <!-- Main line path -->
      {#if linePath}
        <path
          d={linePath}
          fill="none"
          stroke="#10b981"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      {/if}

      <!-- Data point markers (pulsing on the latest point) -->
      {#if svgPoints.length > 0}
        {@const latest = svgPoints[svgPoints.length - 1]}
        <!-- Latest point halo & dot -->
        <circle cx={latest.x} cy={latest.y} r="6" fill="#10b981" fill-opacity="0.35" class="animate-ping" />
        <circle cx={latest.x} cy={latest.y} r="3.5" fill="#34d399" stroke="#064e3b" stroke-width="1.5" />
      {/if}

      <!-- Hover crosshair & tooltip indicator -->
      {#if hoveredPoint}
        <line
          x1={hoverX}
          y1={paddingTop}
          x2={hoverX}
          y2={paddingTop + plotHeight}
          stroke="#06b6d4"
          stroke-width="1.2"
          stroke-dasharray="2,2"
        />
        <circle cx={hoverX} cy={hoverY} r="4.5" fill="#22d3ee" stroke="#083344" stroke-width="2" />
      {/if}

      <!-- X-axis start and end timestamps -->
      {#if points.length > 0}
        <text
          x={paddingLeft}
          y={paddingTop + plotHeight + 18}
          fill="#71717a"
          font-size="10"
          font-family="monospace"
        >
          {formatTime(points[0].timestamp)}
        </text>
        <text
          x={svgWidth - paddingRight}
          y={paddingTop + plotHeight + 18}
          fill="#71717a"
          font-size="10"
          font-family="monospace"
          text-anchor="end"
        >
          {formatTime(points[points.length - 1].timestamp)}
        </text>
      {/if}
    </svg>

    <!-- Floating hover tooltip overlay -->
    {#if hoveredPoint}
      <div
        class="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-2 bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 rounded shadow-xl text-xs font-mono z-20"
        style={`left: ${(hoverX / svgWidth) * 100}%; top: ${(hoverY / svgHeight) * 100}%;`}
      >
        <div class="text-zinc-400 text-[10px]">{formatTime(hoveredPoint.timestamp)}</div>
        <div class="text-emerald-400 font-bold">{hoveredPoint.value.toLocaleString()} {unit}</div>
      </div>
    {/if}

    <!-- Empty state when no data points exist -->
    {#if points.length === 0}
      <div class="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
        <svg class="w-8 h-8 mb-2 opacity-50 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p class="text-xs font-mono">No telemetry data points received yet</p>
      </div>
    {/if}
  </div>
</div>
