<script lang="ts">
  // Endpoint reference rendered from the served OpenAPI document (WP-3.10). Nothing here is
  // hand-written: a path appears exactly when the spec lists it.
  import { listOperations, type OpenApiDocument } from './generators';

  let { spec, baseUrl }: { spec: OpenApiDocument | null; baseUrl: string } = $props();
  const operations = $derived(spec ? listOperations(spec) : []);

  const METHOD_CLASS: Record<string, string> = {
    GET: 'bg-secondary/15 text-secondary',
    POST: 'bg-primary/15 text-primary',
    PATCH: 'bg-tertiary/15 text-tertiary',
    PUT: 'bg-tertiary/15 text-tertiary',
    DELETE: 'bg-error/15 text-error',
  };
</script>

<section class="space-y-3" data-testid="endpoints-list">
  <h2 class="text-title-md font-semibold text-on-surface">Endpoints</h2>
  {#if !spec}
    <p class="text-sm text-on-surface-variant" data-testid="endpoints-loading">Loading the API specification from {baseUrl}/openapi.json…</p>
  {:else}
    {#each operations as { path, method, op } (method + path)}
      <article class="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 space-y-2" data-testid="endpoint">
        <div class="flex items-center gap-2 font-mono text-sm">
          <span class="rounded px-2 py-0.5 text-[11px] font-semibold {METHOD_CLASS[method] ?? ''}">{method}</span>
          <code class="text-on-surface" data-testid="endpoint-path">{path}</code>
        </div>
        {#if op.summary}<p class="text-sm text-on-surface">{op.summary}</p>{/if}
        {#if op.description}<p class="text-xs text-on-surface-variant whitespace-pre-line">{op.description}</p>{/if}
        {#if op.parameters?.length}
          <ul class="text-xs text-on-surface-variant space-y-0.5">
            {#each op.parameters as p}
              <li><code>{p.name}</code> ({p.in}{p.required ? ', required' : ''}){p.description ? ` — ${p.description}` : ''}</li>
            {/each}
          </ul>
        {/if}
      </article>
    {/each}
  {/if}
</section>
