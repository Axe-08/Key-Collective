/**
 * @file generators.ts
 * Code snippet and documentation export generators for ApiDocs.
 */

export function generateCurlSnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${bearerToken}" \\
  -H "x-pool-fallback: lenient" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": ${isStreaming}
  }'`;
}

export function generateTsSnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${bearerToken}',
  baseURL: '${baseUrl}',
  defaultHeaders: { 'x-pool-fallback': 'lenient' }
});

const response = await client.chat.completions.create({
  model: '${selectedModel}',
  messages: [{ role: 'user', content: 'Ping!' }],
  stream: ${isStreaming},
});`;
}

export function generatePySnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `from openai import OpenAI

client = OpenAI(
    api_key="${bearerToken}",
    base_url="${baseUrl}",
    default_headers={"x-pool-fallback": "lenient"}
)

stream = client.chat.completions.create(
    model="${selectedModel}",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=${isStreaming ? 'True' : 'False'}
)`;
}

export function generateOpenApiJson(baseUrl: string): string {
  return JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Key Collective v3 API",
        version: "3.0.0",
        description:
          "Low-latency unified proxy gateway for dynamic model failover & key pooling",
      },
      servers: [{ url: baseUrl }],
      paths: {
        "/v1/chat/completions": {
          post: {
            summary: "Create chat completion",
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["model", "messages"],
                    properties: {
                      model: { type: "string" },
                      messages: {
                        type: "array",
                        items: { type: "object" },
                      },
                      stream: { type: "boolean", default: false },
                      fallback_cascade: {
                        type: "array",
                        items: { type: "string" },
                      },
                      temperature: { type: "number", default: 0.7 },
                    },
                  },
                },
              },
            },
            responses: {
              "200": { description: "Successful response" },
            },
          },
        },
        "/v1/models": {
          get: {
            summary: "List models",
            security: [{ bearerAuth: [] }],
            responses: { "200": { description: "Successful response" } },
          },
        },
        "/v1/projects": {
          get: {
            summary: "List projects",
            security: [{ bearerAuth: [] }],
            responses: { "200": { description: "Successful response" } },
          },
        },
        "/v1/projects/{id}/keys": {
          post: {
            summary: "Generate project key",
            security: [{ bearerAuth: [] }],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "Successful response" } },
          },
        },
        "/v1/health": {
          get: {
            summary: "Health status",
            responses: { "200": { description: "Successful response" } },
          },
        },
        "/v1/telemetry": {
          get: {
            summary: "Telemetry",
            security: [{ bearerAuth: [] }],
            responses: { "200": { description: "Successful response" } },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
    },
    null,
    2
  );
}

export function generateApiDocsMarkdown(
  baseUrl: string,
  curlSnippet: string,
  tsSnippet: string,
  pySnippet: string
): string {
  return `# Key Collective v3 — Developer API Reference

**Base URL:** \`${baseUrl}\`  
**Authentication:** Bearer Token (\`Authorization: Bearer kc_live_...\`)  
**Pricing Ledger:** Fixed-Point Microdollars (\`1 USD = 1,000,000 µ$\`)  
**Gateway Latency:** P99 18.4ms

---

## 1. Quickstart & Headers

API requests are routed through regional edge proxies for minimal latency.

### Request Headers
- \`Authorization: Bearer <key>\` (Required) — Master or scoped ephemeral key.
- \`Content-Type: application/json\` (Required)
- \`x-pool-fallback: lenient | strict | none\` (Optional) — Automatic failover policy.

---

## 2. API Endpoints

### POST \`/v1/chat/completions\`
Creates a completion request routed dynamically across virtualized pools. Automatically alternates real upstream keys, handling rate-limit backoff under 20ms.

#### Parameters
| Field | Type | Default | Description |
|---|---|---|---|
| \`model\` | string | required | Model alias (e.g. \`gemini-3.8-flash\`, \`groq-llama-3.3-70b\`) or wildcard \`auto-fastest\` |
| \`messages\` | array[obj] | required | Array of \`{ role, content }\` chat objects |
| \`stream\` | boolean | \`false\` | Streams partial deltas via Server-Sent Events (SSE) |
| \`fallback_cascade\` | array[str] | \`["auto"]\` | Fallback model sequence if primary key or provider fails |
| \`temperature\` | float | \`0.7\` | Sampling temperature (0.0 to 2.0) |

### GET \`/v1/models\`
Lists all unified active models configured across connected provider pools (Gemini, Groq, Cerebras, DeepSeek, OpenAI) with current load metrics and cost parameters.

### GET \`/v1/projects\`
Inspects workspace hierarchy, team quotas, remaining microdollar balances (µ$), and rate-limit tier thresholds.

### POST \`/v1/projects/:id/keys\`
Generates a new project-scoped virtual key with custom TTL, model white-lists, and token expenditure limits.

### GET \`/v1/health\` & \`/v1/telemetry\`
Retrieves live health status across all upstream nodes, active circuit breaker trips, and 60-second moving average edge latency.

---

## 3. Fixed-Point Microdollar Pricing Reference (µ$)

*Zero floating-point rounding errors. 1.00 USD = exactly 1,000,000 µ$.*  
*Base: 1 µ$ = $0.000001 USD.*

| Model | Input / 1K Tokens | Output / 1K Tokens | Effective USD / 1M | Routing Engine |
|---|---|---|---|---|
| Gemini 2.5 Flash | 75 µ$ | 300 µ$ | $0.075 / $0.30 | Google Edge Direct |
| Groq LLaMA 3.3 (70B) | 590 µ$ | 790 µ$ | $0.59 / $0.79 | LPU Ultrafast |
| DeepSeek V3 | 140 µ$ | 280 µ$ | $0.14 / $0.28 | Multi-Head Latent |

---

## 4. Error Codes

The API returns standard HTTP status codes along with a structured JSON error response.

| Status | Code | Description |
|---|---|---|
| \`400\` | \`bad_request\` | Invalid parameters or malformed JSON payload. |
| \`401\` | \`unauthorized\` | Missing, invalid, or expired Bearer token. |
| \`402\` | \`payment_required\` | Project quota exceeded or insufficient microdollar balance. |
| \`429\` | \`rate_limit_exceeded\` | Too many requests. Respect the \`Retry-After\` header. |
| \`500\` | \`internal_error\` | Unexpected edge gateway or routing failure. |
| \`503\` | \`upstream_unavailable\`| All configured fallback providers are currently unreachable. |

---

## 5. Code Examples

### cURL
\`\`\`bash
${curlSnippet}
\`\`\`

### TypeScript (OpenAI SDK)
\`\`\`typescript
${tsSnippet}
\`\`\`

### Python (OpenAI SDK)
\`\`\`python
${pySnippet}
\`\`\`
`;
}
