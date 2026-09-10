<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let data: any;
  export let filename: string;

  const dispatch = createEventDispatcher<{
    export: { filename: string; content: string };
  }>();

  function formatAsMarkdown(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val.toMarkdown === 'function') return val.toMarkdown();
    if (typeof val.markdown === 'string') return val.markdown;
    if (typeof val.content === 'string') return val.content;
    if (typeof val.text === 'string') return val.text;
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }
    return String(val);
  }

  export function exportMarkdown(): void {
    const content = formatAsMarkdown(data);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const downloadName = filename
      ? (filename.includes('.') ? filename : `${filename}.md`)
      : 'export.md';

    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    dispatch('export', { filename: downloadName, content });
  }
</script>

<button
  type="button"
  on:click={exportMarkdown}
  class="markdown-export-btn"
  {...$$restProps}
>
  <slot>Export Markdown</slot>
</button>
