import fs from "fs";

const MASTER_SECRET = "kc-master-secret-local-dev-key-2026";
const TENANT_ID = "default";
const CLIENT_TOKEN = "kc_test_token_local_dev_12345";

function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveMasterKey(secret) {
  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptKey(plaintext, cryptoKey) {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const ptBytes = new TextEncoder().encode(plaintext);
  const ctBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    cryptoKey,
    ptBytes
  );
  return {
    ciphertextB64: uint8ArrayToBase64(new Uint8Array(ctBuffer)),
    nonceB64: uint8ArrayToBase64(nonce),
  };
}

async function main() {
  const envContent = fs.readFileSync(".env", "utf-8");
  let geminiKeys = [];
  let groqKeys = [];

  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("GEMINI_API_KEYS=")) {
      const val = trimmed.split("=", 2)[1].replace(/^["']|["']$/g, "");
      geminiKeys = val.split(",").map((k) => k.trim()).filter(Boolean);
    } else if (trimmed.startsWith("GROQ_API_KEYS=")) {
      const val = trimmed.split("=", 2)[1].replace(/^["']|["']$/g, "");
      groqKeys = val.split(",").map((k) => k.trim()).filter(Boolean);
    }
  }

  console.log(`Loaded ${geminiKeys.length} Gemini keys and ${groqKeys.length} Groq keys.`);

  const masterCryptoKey = await deriveMasterKey(MASTER_SECRET);
  const sqlStatements = [];

  // 1. Auth Token
  const tokenHash = await sha256Hex(CLIENT_TOKEN);
  sqlStatements.push(`
INSERT OR REPLACE INTO auth_tokens (
  id, hash_sha256, tenant_id, budget_microdollars, spent_microdollars, allowed_providers, rpm_limit
) VALUES (
  'token_local_dev',
  '${tokenHash}',
  '${TENANT_ID}',
  100000000,
  0,
  '["google", "groq", "openai", "anthropic"]',
  120
);`);

  // 2. Encrypt & insert Gemini Keys
  for (let i = 0; i < geminiKeys.length; i++) {
    const raw = geminiKeys[i];
    const { ciphertextB64, nonceB64 } = await encryptKey(raw, masterCryptoKey);
    const prefix = raw.slice(0, 6);
    const suffix = raw.slice(-4);
    const keyId = `key_gemini_${i + 1}`;
    sqlStatements.push(`
INSERT OR REPLACE INTO api_keys (
  id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status
) VALUES (
  '${keyId}',
  '${TENANT_ID}',
  'Gemini Key ${i + 1}',
  'google',
  '${ciphertextB64}',
  '${nonceB64}',
  '${prefix}',
  '${suffix}',
  15,
  1500,
  ${i},
  'Healthy'
);`);
  }

  // 3. Encrypt & insert Groq Keys
  for (let i = 0; i < groqKeys.length; i++) {
    const raw = groqKeys[i];
    const { ciphertextB64, nonceB64 } = await encryptKey(raw, masterCryptoKey);
    const prefix = raw.slice(0, 6);
    const suffix = raw.slice(-4);
    const keyId = `key_groq_${i + 1}`;
    sqlStatements.push(`
INSERT OR REPLACE INTO api_keys (
  id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status
) VALUES (
  '${keyId}',
  '${TENANT_ID}',
  'Groq Key ${i + 1}',
  'groq',
  '${ciphertextB64}',
  '${nonceB64}',
  '${prefix}',
  '${suffix}',
  30,
  14400,
  ${i},
  'Healthy'
);`);
  }

  // 4. Model Registry records
  sqlStatements.push(`
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-2.5-flash', 'google', '["gemini-flash", "google-flash", "flash-2.5"]', 1048576, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-3.5-flash', 'google', '["gemini-3.5", "flash-3.5"]', 1048576, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-3.5-flash-lite', 'google', '["flash-lite", "gemini-lite"]', 1048576, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-3.1-pro-preview', 'google', '["gemini-pro", "gemini-3.1-pro", "pro-3.1"]', 1048576, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-3.8-flash', 'google', '["smart-fast-next", "gemini-3.8", "flash-3.8"]', 1048576, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'qwen/qwen3.6-27b', 'groq', '["groq-code", "qwen-27b"]', 131072, 8192, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'qwen/qwen3.8-27b', 'groq', '["qwen-3.8", "groq-qwen"]', 131072, 8192, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'openai/gpt-oss-120b', 'groq', '["groq-oss", "gpt-oss", "gpt-oss-120b"]', 131072, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'openai/gpt-oss-20b', 'groq', '["gpt-oss-20b", "groq-fast"]', 131072, 65536, 0, 0, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'gemini-2.0-flash', 'google', '["smart-fast", "fast-model", "fast"]', 1048576, 8192, 100000, 400000, 1
);
INSERT OR REPLACE INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens, input_cost_per_mtok_micro, output_cost_per_mtok_micro, is_active
) VALUES (
  'llama-3.3-70b-versatile', 'groq', '["fast-model", "smart-fast"]', 128000, 32768, 590000, 790000, 1
);
`);

  const fullSql = sqlStatements.join("\n");
  fs.writeFileSync("scripts/seed.sql", fullSql);
  console.log(`Generated scripts/seed.sql successfully.`);
}

main().catch(console.error);
