#!/usr/bin/env node
/**
 * verify_catalog.mjs
 *
 * Verifies that every model id declared in src/router/registry/catalog.ts
 * actually exists in the corresponding provider's live models-list endpoint.
 *
 * Reads staging keys from the environment:
 *   - GOOGLE_STAGING_KEY
 *   - GROQ_STAGING_KEY
 *
 * Exits non-zero and prints every catalog id that is missing from its
 * provider's returned id list (e.g. gemini-3.8-flash, qwen/qwen3.8-27b).
 *
 * This is a plain Node ESM script (not run in the Workers runtime), so the
 * catalog's model ids/providers are extracted via a small static parse of
 * the TypeScript source rather than importing it directly.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "..", "src", "router", "registry", "catalog.ts");

const PROVIDER_ENDPOINTS = {
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    envKey: "GOOGLE_STAGING_KEY",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    envKey: "GROQ_STAGING_KEY",
  },
};

/**
 * Statically parses catalog.ts to extract { id, provider } pairs without
 * requiring a TypeScript toolchain.
 */
function parseCatalogEntries(source) {
  const entries = [];
  const idRe = /id:\s*"([^"]+)"/g;
  const providerRe = /provider:\s*"([^"]+)"/g;
  const ids = [...source.matchAll(idRe)].map((m) => m[1]);
  const providers = [...source.matchAll(providerRe)].map((m) => m[1]);
  if (ids.length !== providers.length) {
    throw new Error(
      `Failed to statically parse catalog.ts: found ${ids.length} ids but ${providers.length} providers.`,
    );
  }
  for (let i = 0; i < ids.length; i++) {
    entries.push({ id: ids[i], provider: providers[i] });
  }
  // Gemini entries are declared through the gemini("<id>", ...) helper.
  for (const m of source.matchAll(/\bgemini\(\s*"([^"]+)"/g)) {
    entries.push({ id: m[1], provider: "google" });
  }
  return entries;
}

async function fetchProviderModelIds(provider) {
  const config = PROVIDER_ENDPOINTS[provider];
  if (!config) {
    throw new Error(`No endpoint configured for provider "${provider}".`);
  }
  const apiKey = process.env[config.envKey];
  if (!apiKey) {
    throw new Error(`Missing required environment variable ${config.envKey} for provider "${provider}".`);
  }

  const res = await fetch(config.url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `Provider "${provider}" models endpoint returned HTTP ${res.status}: ${body}`,
    );
  }

  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return new Set(data.map((m) => m.id));
}

async function main() {
  const source = readFileSync(CATALOG_PATH, "utf8");
  const entries = parseCatalogEntries(source);

  const providers = [...new Set(entries.map((e) => e.provider))];
  const providerModelIds = {};

  for (const provider of providers) {
    try {
      providerModelIds[provider] = await fetchProviderModelIds(provider);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exitCode = 1;
      providerModelIds[provider] = null;
    }
  }

  const missing = [];
  for (const { id, provider } of entries) {
    const liveIds = providerModelIds[provider];
    if (liveIds === null) {
      // Provider fetch failed entirely; already reported as an error above.
      continue;
    }
    if (!liveIds.has(id)) {
      missing.push({ id, provider });
    }
  }

  if (missing.length > 0) {
    console.error("Catalog model ids missing from live provider endpoints:");
    for (const { id, provider } of missing) {
      console.error(`  - ${id} (provider: ${provider})`);
    }
    process.exitCode = 1;
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  } else {
    console.log("All catalog model ids verified against live provider endpoints.");
  }
}

main().catch((err) => {
  console.error(`Unexpected failure: ${err.stack || err.message}`);
  process.exit(1);
});
