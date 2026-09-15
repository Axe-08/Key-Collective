import re

with open("ui/src/lib/ApiDocs.svelte", "r") as f:
    content = f.read()

pricing_section_start = content.find('<section class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-5 specular-top" id="pricing-matrix">')
tbody_start = content.find('<tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">', pricing_section_start)
tbody_end = content.find('</tbody>', tbody_start) + len('</tbody>')

fallback_rows = content[tbody_start:tbody_end]
fallback_inner = fallback_rows[len('<tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">'):-len('</tbody>')]

new_tbody = """<tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">
              {#if modelsData}
                {#each modelsData as model}
                  <tr class="hover:bg-white/[0.02] transition-colors">
                    <td class="py-3 pr-3 font-semibold text-on-surface flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-secondary"></span>
                      <span>{model.id}</span>
                    </td>
                    <td class="py-3 px-3 text-secondary">{model.cost_micros.input_1k} µ$</td>
                    <td class="py-3 px-3 text-secondary">{model.cost_micros.output_1k} µ$</td>
                    <td class="py-3 px-3 text-on-surface">${(model.cost_micros.input_1k * 1000 / 1000000).toFixed(2)} / ${(model.cost_micros.output_1k * 1000 / 1000000).toFixed(2)}</td>
                    <td class="py-3 pl-3 text-outline">{model.routing_engine || 'Edge Routing'}</td>
                  </tr>
                {/each}
              {:else}""" + fallback_inner + """              {/if}
            </tbody>"""

content = content[:tbody_start] + new_tbody + content[tbody_end:]

with open("ui/src/lib/ApiDocs.svelte", "w") as f:
    f.write(content)
print("done replacing pricing table")
