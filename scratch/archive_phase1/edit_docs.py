import re

with open("ui/src/lib/ApiDocs.svelte", "r") as f:
    content = f.read()

# 1. Fetching /v1/models for pricing table
# Add a new block in the script section to fetch the data
script_end = content.find("</script>")

fetch_code = """
  // Live Pricing Data State
  let modelsData = $state<Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    routing_engine: string;
    cost_micros: {
      input_1k: number;
      output_1k: number;
    }
  }> | null>(null);

  $effect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('https://key-col.axe08.tech/v1/models');
        if (res.ok) {
          const data = await res.json();
          if (data && data.data) {
            modelsData = data.data;
          }
        }
      } catch (err) {
        console.error("Failed to fetch live models pricing:", err);
      }
    }
    fetchModels();
  });
"""
content = content[:script_end] + fetch_code + content[script_end:]

with open("ui/src/lib/ApiDocs.svelte", "w") as f:
    f.write(content)
print("done step 1")
