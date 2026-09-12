/**
 * Key Collective v3 — OpenAPI 3.1.0 Formal Specification
 *
 * Full schema compliance for automated agent tool calling, OpenAPI generator CLI,
 * and developer documentation consoles.
 */

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Key Collective Edge Proxy API",
    version: "3.1.0",
    description:
      "Enterprise multi-tenant LLM router and dynamic key pool with zero-plaintext storage, AES-256-GCM encryption, sub-10ms edge routing, and automated failover.",
    contact: {
      name: "Key Collective Team",
      url: "https://key-col.axe08.tech",
      email: "support@keycollective.io",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "https://key-col.axe08.tech",
      description: "Primary Edge Gateway (Cloudflare Global Anycast)",
    },
    {
      url: "https://console.key-col.axe08.tech",
      description: "Developer Console Gateway",
    },
  ],
  tags: [
    {
      name: "Chat",
      description: "OpenAI-compatible inference proxy endpoints with multi-model failover cascades",
    },
    {
      name: "Models",
      description: "Catalog of registered upstream models and alias resolutions",
    },
    {
      name: "Keys",
      description: "Virtual and upstream API credential lifecycle management",
    },
    {
      name: "Telemetry",
      description: "Tenant-isolated request audit logs and operational metrics",
    },
    {
      name: "System",
      description: "Cluster health, edge runtime probes, and OpenAPI metadata",
    },
  ],
  paths: {
    "/v1/chat/completions": {
      post: {
        tags: ["Chat"],
        summary: "Create chat completion",
        description:
          "Dispatches an OpenAI-compatible chat completion request through Key Collective's resilient edge cascade router with dynamic key rotation, quota tracking, and automatic failover.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "x-pool-fallback",
            in: "header",
            description: "Fallback strategy across model cascades ('strict' | 'lenient')",
            required: false,
            schema: {
              type: "string",
              enum: ["strict", "lenient"],
              default: "lenient",
            },
          },
          {
            name: "x-tenant-id",
            in: "header",
            description: "Tenant namespace for key isolation (administrators only)",
            required: false,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatCompletionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful chat completion (JSON payload or SSE event stream)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatCompletionResponse" },
              },
              "text/event-stream": {
                schema: { type: "string", description: "OpenAI-compatible SSE stream" },
              },
            },
          },
          "400": {
            description: "Bad Request: Malformed JSON or invalid parameters",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Unauthorized: Missing, invalid, or expired authentication token",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "403": {
            description: "Forbidden: Account quarantined or tier permissions insufficient",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "429": {
            description: "Rate Limit or Daily Quota Exceeded",
            headers: {
              "retry-after": {
                schema: { type: "integer" },
                description: "Seconds until rate limit reset",
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "503": {
            description: "Service Unavailable: Circuit breaker open or key pool exhausted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/v1/models": {
      get: {
        tags: ["Models"],
        summary: "List registered models",
        description: "Retrieves the active catalog of all available models, aliases, and provider mappings.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "List of available models",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    object: { type: "string", example: "list" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Model" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/models/{id}": {
      get: {
        tags: ["Models"],
        summary: "Retrieve model detail",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Target model ID or alias (e.g. 'gemini-2.5-flash')",
            schema: { type: "string" },
          },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Model metadata and capability profile",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Model" },
              },
            },
          },
          "404": {
            description: "Model not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        tags: ["System"],
        summary: "System health & edge probe",
        description: "Public liveness check for Cloudflare Anycast edge status and worker version.",
        responses: {
          "200": {
            description: "Cluster is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "healthy" },
                    version: { type: "string", example: "0.2.0" },
                    runtime: { type: "string", example: "cloudflare-workers" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["System"],
        summary: "OpenAPI 3.1 Specification JSON",
        description: "Returns the machine-readable OpenAPI 3.1 document for client generation and agent tool execution.",
        responses: {
          "200": {
            description: "OpenAPI 3.1 specification",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
    "/api/keys": {
      get: {
        tags: ["Keys"],
        summary: "List tenant API keys",
        description: "Lists active and revoked API keys in the authenticated tenant pool (or all keys if administrator).",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Array of API key records",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ApiKey" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Keys"],
        summary: "Create API key in pool",
        description: "Registers and encrypts a new provider credential with Web Crypto AES-256-GCM.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider", "key"],
                properties: {
                  provider: { type: "string", example: "google" },
                  key: { type: "string", example: "AIzaSy..." },
                  label: { type: "string", example: "Production Gemini 2.5 Key" },
                  rpm_limit: { type: "integer", default: 60 },
                  rpd_limit: { type: "integer", default: 1000 },
                  priority: { type: "integer", default: 1 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Key created and encrypted successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiKey" },
              },
            },
          },
        },
      },
    },
    "/api/keys/{id}": {
      delete: {
        tags: ["Keys"],
        summary: "Delete API key",
        description: "Permanently deletes an API key from D1 and purges cached key material from Durable Objects.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Key deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { success: { type: "boolean", example: true } },
                },
              },
            },
          },
        },
      },
    },
    "/api/keys/{id}/test": {
      post: {
        tags: ["Keys"],
        summary: "Test upstream key validity",
        description: "Executes a lightweight dry-run probe against the upstream provider to test credential authentication.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Test execution result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    latency_ms: { type: "number" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/logs": {
      get: {
        tags: ["Telemetry"],
        summary: "Get request audit logs",
        description: "Retrieves the recent request log records strictly scoped to the authenticated tenant (or global cluster if admin).",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "List of request logs",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/RequestLog" },
                },
              },
            },
          },
        },
      },
    },
    "/api/stats": {
      get: {
        tags: ["Telemetry"],
        summary: "Get operational metrics & quota",
        description: "Calculates real-time RPM headroom, quota consumption, and key pool health.",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Cluster and tenant operational metrics",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PoolStats" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT / KeyCollective Token",
        description: "Client virtual project key (e.g. `kc_proj_live_...`) or user Bearer token.",
      },
      MasterKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-kc-master-key",
        description: "Cluster administrator master key.",
      },
    },
    schemas: {
      ChatCompletionRequest: {
        type: "object",
        required: ["model", "messages"],
        properties: {
          model: {
            type: "string",
            description: "Model ID or alias (e.g. 'gemini-2.5-flash', 'llama-3.3-70b-versatile')",
            example: "gemini-2.5-flash",
          },
          messages: {
            type: "array",
            items: {
              type: "object",
              required: ["role", "content"],
              properties: {
                role: {
                  type: "string",
                  enum: ["system", "user", "assistant", "tool"],
                },
                content: { type: "string" },
              },
            },
          },
          stream: {
            type: "boolean",
            default: false,
            description: "Enable Server-Sent Events (SSE) streaming output",
          },
          temperature: { type: "number", minimum: 0, maximum: 2, default: 0.7 },
          max_tokens: { type: "integer", minimum: 1 },
        },
      },
      ChatCompletionResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string", example: "chat.completion" },
          created: { type: "integer" },
          model: { type: "string" },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                message: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    content: { type: "string" },
                  },
                },
                finish_reason: { type: "string", nullable: true },
              },
            },
          },
          usage: {
            type: "object",
            properties: {
              prompt_tokens: { type: "integer" },
              completion_tokens: { type: "integer" },
              total_tokens: { type: "integer" },
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["message", "code", "statusCode"],
            properties: {
              message: { type: "string", description: "Human-readable diagnostic description" },
              code: {
                type: "string",
                enum: [
                  "BAD_REQUEST",
                  "INVALID_TOKEN",
                  "EXPIRED_TOKEN",
                  "QUARANTINED",
                  "INSUFFICIENT_TIER",
                  "ZERO_KNOWLEDGE_DENIAL",
                  "RATE_LIMIT_EXCEEDED",
                  "QUOTA_EXCEEDED",
                  "UPSTREAM_FAILURE",
                  "ALL_KEYS_EXHAUSTED",
                  "CIRCUIT_OPEN",
                ],
                description: "Standard machine-readable error classification code",
              },
              statusCode: { type: "integer", description: "HTTP status code" },
              details: { type: "object", additionalProperties: true },
              retryAfter: { type: "integer", description: "Seconds until retry allowed" },
            },
          },
        },
      },
      Model: {
        type: "object",
        properties: {
          id: { type: "string", example: "gemini-2.5-flash" },
          object: { type: "string", example: "model" },
          owned_by: { type: "string", example: "google" },
          context_window: { type: "integer", example: 1048576 },
          input_cost_microdollars: { type: "integer", example: 75 },
          output_cost_microdollars: { type: "integer", example: 300 },
          supports_streaming: { type: "boolean", example: true },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string", example: "key_01jh9x81m" },
          label: { type: "string", example: "Production Gemini Key" },
          provider: { type: "string", example: "google" },
          key_prefix: { type: "string", example: "AIzaSy" },
          rpm_limit: { type: "integer", example: 60 },
          rpd_limit: { type: "integer", example: 1000 },
          status: { type: "string", enum: ["active", "rate_limited", "invalid"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      RequestLog: {
        type: "object",
        properties: {
          id: { type: "string" },
          key_id: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          status_code: { type: "integer" },
          latency_ms: { type: "number" },
          bytes_in: { type: "integer" },
          bytes_out: { type: "integer" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      PoolStats: {
        type: "object",
        properties: {
          total_keys: { type: "integer" },
          healthy_keys: { type: "integer" },
          rate_limited_keys: { type: "integer" },
          invalid_keys: { type: "integer" },
          total_rpm_headroom: { type: "integer" },
          total_rpm_limit: { type: "integer" },
          current_rpm_used: { type: "integer" },
          avg_upstream_latency_ms: { type: "number" },
          daily_quota_used: { type: "integer" },
          daily_quota_limit: { type: "integer" },
          proxy_status: { type: "string", enum: ["healthy", "degraded", "outage"] },
        },
      },
    },
  },
} as const;
