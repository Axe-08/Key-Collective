import re

with open("ui/src/lib/ApiDocs.svelte", "r") as f:
    content = f.read()

def generate_table(title, rows, is_request=True):
    headers = ["Field", "Type", "Default", "Description"] if is_request else ["Field", "Type", "Description"]
    
    header_html = ""
    if is_request:
        header_html = """
                      <th class="py-2 pr-3">Field</th>
                      <th class="py-2 px-3">Type</th>
                      <th class="py-2 px-3">Default</th>
                      <th class="py-2 pl-3">Description</th>"""
    else:
        header_html = """
                      <th class="py-2 pr-3">Field</th>
                      <th class="py-2 px-3">Type</th>
                      <th class="py-2 pl-3">Description</th>"""

    rows_html = ""
    for row in rows:
        if is_request:
            rows_html += f"""
                    <tr>
                      <td class="py-2.5 pr-3 font-semibold text-primary">{row[0]}</td>
                      <td class="py-2.5 px-3 text-outline">{row[1]}</td>
                      <td class="py-2.5 px-3 text-outline">{row[2]}</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">{row[3]}</td>
                    </tr>"""
        else:
            rows_html += f"""
                    <tr>
                      <td class="py-2.5 pr-3 font-semibold text-primary">{row[0]}</td>
                      <td class="py-2.5 px-3 text-outline">{row[1]}</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">{row[2]}</td>
                    </tr>"""
                    
    return f"""
            <div>
              <div class="text-label-sm font-label-sm uppercase tracking-wider text-outline mb-2 mt-4">{title}</div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-body-sm font-body-sm border-collapse">
                  <thead>
                    <tr class="border-b border-outline-variant/30 text-label-sm font-label-sm text-outline">{header_html}
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">{rows_html}
                  </tbody>
                </table>
              </div>
            </div>"""

models_response = [
    ("data", "array[obj]", "List of available models with their pricing and routing details."),
    ("object", "string", "Always <code class='text-secondary'>list</code>."),
]
models_table = generate_table("Response Body Parameters", models_response, False)

projects_response = [
    ("data", "array[obj]", "List of projects and their workspace hierarchy."),
    ("quotas", "object", "Team quotas and limits."),
    ("balance_micros", "integer", "Remaining microdollar balance."),
]
projects_table = generate_table("Response Body Parameters", projects_response, False)

keys_request = [
    ("ttl_seconds", "integer", "86400", "Time-to-live for the key in seconds."),
    ("models", "array[str]", "[\"*\"]", "Allowed models for this key."),
    ("max_spend_micros", "integer", "1000000", "Maximum microdollars this key can consume."),
]
keys_response = [
    ("id", "string", "Unique key identifier starting with <code class='text-secondary'>kc_live_</code>."),
    ("expires_at", "integer", "Unix timestamp of key expiration."),
    ("key", "string", "The actual Bearer token string."),
]
keys_table = generate_table("Request Body Parameters", keys_request, True) + generate_table("Response Body Parameters", keys_response, False)

health_response = [
    ("status", "string", "Overall gateway health (<code class='text-secondary'>ok</code>, <code class='text-error'>degraded</code>)."),
    ("latency_ms", "float", "60-second moving average edge latency."),
    ("circuit_trips", "integer", "Number of active upstream circuit breaker trips."),
]
health_table = generate_table("Response Body Parameters", health_response, False)


def insert_table(content, endpoint_id, table_html):
    # Find the p tag describing the endpoint inside the div with id/class that matches the endpoint
    # E.g. <div class="rounded-xl ... " id="models">
    # Wait, the other endpoints don't have ids except models. Let's find by their title.
    # E.g. <code class="font-code-md ...">/v1/projects</code>
    
    start_idx = content.find(f'>{endpoint_id}</code>')
    if start_idx == -1:
        print(f"Could not find {endpoint_id}")
        return content
        
    # Find the closing </p> after this
    p_end = content.find('</p>', start_idx) + 4
    
    # Insert there
    # We should wrap it in <div class="p-4 space-y-4"> like the first one, or just append it.
    # The others are simple divs. Let's wrap the description and the table inside a container if needed.
    # Actually, they are structured like:
    # <div class="rounded-xl ...">
    #   <div class="flex items-center ...">...</div>
    #   <p class="...">...</p>
    # </div>
    # So inserting after </p> works perfectly.
    
    return content[:p_end] + table_html + content[p_end:]


content = insert_table(content, "/v1/models", models_table)
content = insert_table(content, "/v1/projects", projects_table)
content = insert_table(content, "/v1/projects/:id/keys", keys_table)
content = insert_table(content, "/v1/health &amp; /v1/telemetry", health_table)

with open("ui/src/lib/ApiDocs.svelte", "w") as f:
    f.write(content)

print("done adding tables")
