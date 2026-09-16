<script lang="ts">
  interface Props {
    baseUrl: string;
    bearerToken: string;
    activeProvider: string;
  }

  let { baseUrl, bearerToken, activeProvider }: Props = $props();

  let expandedEndpoint = $state<string | null>('chat');

  function toggle(id: string) {
    expandedEndpoint = expandedEndpoint === id ? null : id;
  }
</script>

<div class="space-y-4 font-sans">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-title-lg font-title-lg font-semibold text-on-surface flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[22px]">api</span>
        Virtual Edge API Endpoints
      </h2>
      <p class="text-xs text-outline font-mono mt-0.5">
        Complete REST &amp; SSE Gateway Specification (OpenAI Spec 3.1.0 Compliant)
      </p>
    </div>
    <span class="px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-mono font-medium">
      9 Active Endpoints
    </span>
  </div>

  <!-- 1. POST /v1/chat/completions -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('chat')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-primary/20 text-primary font-mono text-xs font-bold">POST</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/chat/completions</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-secondary/10 text-secondary border border-secondary/20">SSE Stream</span>
        <span class="text-xs text-outline hidden md:inline">— Unified Chat Completions with Resilient Key Pooling</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'chat' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'chat'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs leading-relaxed">
          Primary LLM proxy hot path. Dispatches across pooled keys, rotating automatically when rate-limit thresholds or upstream outages occur. Zero latency overhead via Cloudflare Edge isolates.
        </p>

        <!-- Headers -->
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Request Headers</div>
          <div class="p-3 rounded-lg bg-surface-container/60 border border-outline-variant/20 space-y-1">
            <div class="flex items-center justify-between"><span class="text-primary font-bold">Authorization</span><span class="text-on-surface">Bearer &lt;kc_token&gt;</span></div>
            <div class="flex items-center justify-between"><span class="text-primary font-bold">Content-Type</span><span class="text-on-surface">application/json</span></div>
            <div class="flex items-center justify-between text-outline"><span class="font-bold">x-pool-fallback</span><span>lenient | strict | none (default: lenient)</span></div>
            <div class="flex items-center justify-between text-outline"><span class="font-bold">x-tenant-id</span><span>usr_gh_... | default (optional tenant scope)</span></div>
          </div>
        </div>

        <!-- Request Body -->
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Request Body (JSON)</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-on-surface text-[11px] overflow-x-auto"><code>{`{
  "model": "gemini-3.8-flash", // or "auto-fastest", "llama-3.3-70b-versatile"
  "messages": [
    { "role": "system", "content": "You are a helpful coding assistant." },
    { "role": "user", "content": "Explain circuit breaker pattern in 2 lines." }
  ],
  "stream": true, // optional SSE streaming deltas
  "temperature": 0.4,
  "max_tokens": 1024
}`}</code></pre>
        </div>

        <!-- Response Body -->
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Body (Buffered 200 OK)</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "id": "chatcmpl-kc-9f83a00c",
  "object": "chat.completion",
  "created": 1726484192,
  "model": "gemini-3.8-flash",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "A circuit breaker trips on failures..." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 28, "completion_tokens": 42, "total_tokens": 70 },
  "cost_microdollars": 14
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 2. GET /v1/models -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('models')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/models</span>
        <span class="text-xs text-outline hidden md:inline">— Model Catalog with Live Routing Metadata &amp; Pricing</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'models' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'models'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Lists all available models configured across connected provider backends (Gemini, Groq, Cerebras, SambaNova, DeepSeek, OpenAI) along with provider health and free-tier compatibility.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "object": "list",
  "data": [
    {
      "id": "gemini-3.8-flash",
      "object": "model",
      "owned_by": "google",
      "input_cost_microdollars": 0,
      "output_cost_microdollars": 0,
      "free_tier": true,
      "context_window": 1048576,
      "routing_status": "healthy"
    },
    {
      "id": "llama-3.3-70b-versatile",
      "object": "model",
      "owned_by": "groq",
      "input_cost_microdollars": 0,
      "output_cost_microdollars": 0,
      "free_tier": true,
      "context_window": 128000,
      "routing_status": "healthy"
    }
  ]
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 3. GET /v1/projects -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('projects')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/projects</span>
        <span class="text-xs text-outline hidden md:inline">— Multi-Tenant Quotas, Assigned RPM &amp; Microdollar Balances</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'projects' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'projects'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Inspects tenant workspace hierarchy, sub-project routing namespaces, team RPM subcaps, and ledger spend.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Headers</div>
          <div class="p-3 rounded-lg bg-surface-container/60 border border-outline-variant/20 text-on-surface">
            <div><span class="text-primary font-bold">Authorization:</span> Bearer &lt;admin_or_user_token&gt;</div>
          </div>
        </div>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`[
  {
    "id": "proj_prod_gateway",
    "name": "Production Gateway",
    "slug": "prod-gateway",
    "max_rpm_sub_cap": 30,
    "assigned_rpm": 15,
    "active_keys_count": 3,
    "total_spend_microdollars": 142050,
    "created_at": "2026-09-10T12:00:00Z"
  }
]`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 4. POST /v1/projects/:id/keys -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('project_keys')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-primary/20 text-primary font-mono text-xs font-bold">POST</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/projects/:id/keys</span>
        <span class="text-xs text-outline hidden md:inline">— Generate Project-Scoped Virtual Key with Rate Limits</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'project_keys' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'project_keys'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Creates a virtual client credential scoped to a project. The full plaintext token is returned exactly once upon creation.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Request Body</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-on-surface text-[11px] overflow-x-auto"><code>{`{
  "name": "prod-agent-client",
  "rpm_limit": 20,
  "budget_microdollars": 5000000, // $5.00 limit
  "allowed_providers": ["google", "groq"]
}`}</code></pre>
        </div>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "id": "key_virt_9281a",
  "name": "prod-agent-client",
  "token": "kc_live_83910c2830f81a7b6291a0c91823901b",
  "token_prefix": "kc_live_83910c",
  "rpm_limit": 20,
  "created_at": "2026-09-16T12:00:00Z"
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 5. GET /v1/health & /v1/telemetry -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('health')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/health &amp; /v1/telemetry</span>
        <span class="text-xs text-outline hidden md:inline">— Edge Liveness, Circuit Breaker Trips &amp; Latency</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'health' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'health'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Real-time edge health probes. Returns cluster circuit status, active rate limits, and 60-second moving average upstream response latency.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "status": "healthy",
  "edge_region": "iad",
  "active_circuit_trips": 0,
  "moving_avg_latency_ms": 14,
  "available_keys_count": 22,
  "uptime_seconds": 864200
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 6. POST /v1/report -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('report')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-primary/20 text-primary font-mono text-xs font-bold">POST</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/report</span>
        <span class="text-xs text-outline hidden md:inline">— Takedown Reporting Shield for Compromised Keys</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'report' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'report'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Submits a security report for an abused or leaked upstream API key. Enforces constant-time cryptographic timing shields to prevent side-channel probing.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Request Body</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-on-surface text-[11px] overflow-x-auto"><code>{`{
  "key_id": "key_gemini_4",
  "reason": "compromised", // or "rate_limit_leak", "invalid_credentials"
  "description": "Reported revoked by upstream provider"
}`}</code></pre>
        </div>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "status": "acknowledged",
  "action": "quarantine_for_verification",
  "timestamp": "2026-09-16T12:00:00Z"
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 7. GET /api/pool/telemetry -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('pool_telemetry')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/api/pool/telemetry</span>
        <span class="text-xs text-outline hidden md:inline">— Community Reciprocity Commons &amp; Observation Status</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'pool_telemetry' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'pool_telemetry'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Live reciprocity metrics for the community commons: total active keys, observation queues, communal dispatches, and provider breakdowns.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "total_active_keys": 22,
  "keys_in_observation": 0,
  "quarantined_keys": 0,
  "total_dispatched_today": 8421,
  "total_dispatched_communal": 4120,
  "providers": [
    { "name": "gemini", "active": 17, "observation": 0, "quarantined": 0 },
    { "name": "groq", "active": 5, "observation": 0, "quarantined": 0 }
  ]
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 8. GET /api/pool/standing -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('pool_standing')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/api/pool/standing</span>
        <span class="text-xs text-outline hidden md:inline">— Reciprocal Quota Standing &amp; Reciprocity Score</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'pool_standing' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'pool_standing'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Calculates tenant reciprocity score, daily communal allowance, and vesting tier (Tier 0: Observation, Tier 1: Standard Reciprocity, Tier 2: Vested Unlimited).
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "tenant_id": "usr_gh_12345",
  "reciprocity_score": 94,
  "vesting_tier": 2,
  "daily_allowance_requests": 10000,
  "used_requests_today": 450,
  "status": "good_standing"
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>

  <!-- 9. GET /api/pool/contribution -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => toggle('pool_contribution')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/api/pool/contribution</span>
        <span class="text-xs text-outline hidden md:inline">— Contributed Keys Portfolio &amp; Community Routing Yield</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'pool_contribution' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'pool_contribution'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans text-xs">
          Detailed breakdown of all keys contributed by the authenticated account to the shared community pool, observation countdowns, and cumulative tokens routed.
        </p>
        <div class="space-y-1.5">
          <div class="text-outline uppercase text-[10px] font-semibold tracking-wider">Response Example</div>
          <pre class="p-3 rounded-lg bg-black/40 border border-white/[0.06] text-secondary text-[11px] overflow-x-auto"><code>{`{
  "contributed_keys_count": 3,
  "lifetime_communal_dispatches": 18240,
  "earned_allowance_multiplier": 2.5,
  "keys": [
    { "id": "key_gemini_1", "provider": "gemini", "pool_type": "PRIVATE" },
    { "id": "key_gemini_2", "provider": "gemini", "pool_type": "COMMUNITY", "status": "ACTIVE" }
  ]
}`}</code></pre>
        </div>
      </div>
    {/if}
  </div>
</div>
