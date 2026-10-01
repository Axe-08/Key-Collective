<script lang="ts">
  // Cloudflare Turnstile, explicit rendering (WP-3.6). The script tag lives in index.html;
  // the site key comes from VITE_TURNSTILE_SITE_KEY. Tokens are single-use: call reset()
  // after every submission.
  import { onDestroy, onMount } from 'svelte';

  interface TurnstileApi {
    render(el: HTMLElement, options: Record<string, unknown>): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  }

  let { token = $bindable('') }: { token?: string } = $props();

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  let container: HTMLDivElement | undefined = $state();
  let widgetId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function api(): TurnstileApi | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  }

  function render(): boolean {
    const ts = api();
    if (!ts || !container || !siteKey || widgetId !== null) return false;
    widgetId = ts.render(container, {
      sitekey: siteKey,
      theme: 'dark',
      callback: (t: string) => (token = t),
      'expired-callback': () => (token = ''),
      'error-callback': () => (token = ''),
    });
    return true;
  }

  export function reset(): void {
    token = '';
    const ts = api();
    if (ts && widgetId !== null) ts.reset(widgetId);
  }

  onMount(() => {
    if (!render()) {
      // The script loads async; wait for window.turnstile.
      pollTimer = setInterval(() => {
        if (render() && pollTimer) clearInterval(pollTimer);
      }, 200);
    }
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    const ts = api();
    if (ts && widgetId !== null) ts.remove(widgetId);
  });
</script>

{#if siteKey}
  <div bind:this={container} data-testid="turnstile"></div>
{:else}
  <p class="text-[11px] text-amber-300" data-testid="turnstile-missing">Bot check unavailable: VITE_TURNSTILE_SITE_KEY is not set.</p>
{/if}
