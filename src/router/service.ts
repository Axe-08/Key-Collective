/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Router Service Module (router-service)
 *
 * Implements RouterContract:
 * - Orchestrates KeyPoolContract.getKey to acquire provider keys.
 * - Invokes Proxy client (UpstreamClient or LlmProxyClient) to execute LLM calls.
 * - Tracks microdollar cost with KeyPoolContract.recordUsage.
 * - Emits non-blocking telemetry via TelemetryContract.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - No Plaintext Keys: Provider keys are kept in-memory for request duration only.
 * - Per-Tenant DO Isolation: Tenant-scoped key pool and telemetry tagging.
 * - Fixed-Point Microdollars: All costs in int64/bigint microdollars. Zero floating-point math.
 * - Non-Blocking Telemetry: Hot path never blocks on telemetry emission.
 */

import type { RouteRequest, RouteResponse, RouterContract } from "../contracts/router";
import type { KeyPoolContract } from "../contracts/key_pool";
import type { TelemetryContract, TelemetryEvent } from "../contracts/telemetry";
import { IModelRegistry, ModelRegistry } from "./model_registry";
import {
  UpstreamClient,
  UpstreamChatRequest,
  UpstreamChatResponse,
  extractContentFromPayload,
} from "../proxy/upstream_client";
import { LlmProxyClient, ForwardProxyOptions, ProxyResult } from "../proxy/client";
import { calculateCost, TokenUsage } from "../proxy/cost_calculator";
import { InvalidKeyError } from "../errors";

/**
 * Structural interface matching supported Proxy clients (UpstreamClient or LlmProxyClient).
 */
export type ProxyClientLike =
  | UpstreamClient
  | LlmProxyClient
  | {
      chat?(request: UpstreamChatRequest): Promise<UpstreamChatResponse>;
      forward?(options: ForwardProxyOptions): Promise<ProxyResult>;
    };

/**
 * Options configuring RouterService.
 */
export interface RouterServiceOptions {
  /** Injected KeyPoolContract instance */
  keyPool: KeyPoolContract;
  /** Injected Proxy Client instance (defaults to UpstreamClient) */
  proxyClient?: ProxyClientLike;
  /** Injected TelemetryContract instance */
  telemetry?: TelemetryContract;
  /** Injected ModelRegistry instance (defaults to standard ModelRegistry) */
  modelRegistry?: IModelRegistry;
  /** Tenant ID for DO isolation and telemetry tagging */
  tenantId?: string;
  /** Custom trace ID generator function */
  traceIdGenerator?: () => string;
}

/**
 * RouterService orchestrates key acquisition, upstream proxy execution,
 * microdollar usage tracking, and telemetry emission.
 */
export class RouterService implements RouterContract {
  private readonly keyPool: KeyPoolContract;
  private readonly proxyClient: ProxyClientLike;
  private readonly telemetry?: TelemetryContract;
  private readonly modelRegistry: IModelRegistry;
  private readonly tenantId: string;
  private readonly traceIdGenerator: () => string;

  constructor(options: RouterServiceOptions);
  constructor(
    keyPool: KeyPoolContract,
    proxyClient?: ProxyClientLike,
    telemetry?: TelemetryContract,
    options?: Partial<RouterServiceOptions>
  );
  constructor(
    optionsOrKeyPool: RouterServiceOptions | KeyPoolContract,
    proxyClient?: ProxyClientLike,
    telemetry?: TelemetryContract,
    extraOptions?: Partial<RouterServiceOptions>
  ) {
    if (optionsOrKeyPool && "keyPool" in optionsOrKeyPool) {
      const opts = optionsOrKeyPool as RouterServiceOptions;
      this.keyPool = opts.keyPool;
      this.telemetry = opts.telemetry;
      this.modelRegistry = opts.modelRegistry ?? new ModelRegistry();
      this.tenantId = opts.tenantId ?? "default";
      this.traceIdGenerator = opts.traceIdGenerator ?? (() => crypto.randomUUID());
      this.proxyClient =
        opts.proxyClient ??
        new UpstreamClient({
          keyPool: this.keyPool,
          costCalculator: (model, usage) => {
            try {
              return this.modelRegistry.calculateCost(model, usage);
            } catch {
              return 0n;
            }
          },
        });
    } else {
      this.keyPool = optionsOrKeyPool as KeyPoolContract;
      this.telemetry = telemetry;
      this.modelRegistry = extraOptions?.modelRegistry ?? new ModelRegistry();
      this.tenantId = extraOptions?.tenantId ?? "default";
      this.traceIdGenerator = extraOptions?.traceIdGenerator ?? (() => crypto.randomUUID());
      this.proxyClient =
        proxyClient ??
        new UpstreamClient({
          keyPool: this.keyPool,
          costCalculator: (model, usage) => {
            try {
              return this.modelRegistry.calculateCost(model, usage);
            } catch {
              return 0n;
            }
          },
        });
    }
  }

  /**
   * Resolves the target model ID and provider from a model alias or identifier.
   */
  private resolveModelAndProvider(modelAlias: string): { modelId: string; provider: string } {
    const alias = (modelAlias ?? "").trim();
    if (!alias) {
      return { modelId: "gpt-4o", provider: "openai" };
    }

    const resolved = this.modelRegistry.resolveModel(alias);
    if (resolved) {
      return { modelId: resolved.id, provider: resolved.provider };
    }

    if (alias.includes("/")) {
      const parts = alias.split("/");
      return { provider: parts[0], modelId: parts.slice(1).join("/") };
    }

    const lower = alias.toLowerCase();
    if (
      lower.startsWith("gpt") ||
      lower.startsWith("o1") ||
      lower.startsWith("text-embedding") ||
      lower.startsWith("davinci")
    ) {
      return { modelId: alias, provider: "openai" };
    }
    if (lower.startsWith("claude")) {
      return { modelId: alias, provider: "anthropic" };
    }
    if (lower.startsWith("gemini")) {
      return { modelId: alias, provider: "google" };
    }
    if (lower.startsWith("llama") || lower.startsWith("mixtral") || lower.startsWith("gemma")) {
      return { modelId: alias, provider: "groq" };
    }
    if (lower.startsWith("deepseek")) {
      return { modelId: alias, provider: "deepseek" };
    }
    if (lower.startsWith("command")) {
      return { modelId: alias, provider: "cohere" };
    }

    return { modelId: alias, provider: "openai" };
  }

  /**
   * Routes an incoming RouteRequest:
   * 1. Resolves model & provider from alias.
   * 2. Acquires API key from KeyPoolContract.
   * 3. Invokes Proxy client.
   * 4. Tracks cost with KeyPoolContract.recordUsage.
   * 5. Emits telemetry via TelemetryContract.
   *
   * @param request Inbound route request
   * @returns RouteResponse with content and costMicrodollars
   */
  public async route(request: RouteRequest): Promise<RouteResponse> {
    const startTime = Date.now();
    const traceId = this.traceIdGenerator();

    if (!request || typeof request !== "object") {
      throw new Error("Invalid route request: request must be an object");
    }

    const { modelId, provider } = this.resolveModelAndProvider(request.modelAlias);
    let keyId = "";
    let apiKey = "";

    try {
      // 1. Orchestrates KeyPoolContract.getKey
      apiKey = await this.keyPool.getKey(provider);
      keyId = apiKey;

      if (!apiKey || apiKey.trim().length === 0) {
        throw new InvalidKeyError(`No valid key returned from pool for provider '${provider}'`, {
          provider,
        });
      }

      let content = "";
      let costMicrodollars = 0n;

      // 2. Invokes Proxy client
      if (
        "chat" in this.proxyClient &&
        typeof this.proxyClient.chat === "function"
      ) {
        const chatRes = await this.proxyClient.chat({
          provider,
          model: modelId,
          messages: request.messages ?? [],
          stream: request.stream ?? false,
          apiKey,
          keyId,
        });

        content = chatRes.content ?? "";
        costMicrodollars = chatRes.costMicrodollars ?? 0n;

        if (costMicrodollars === 0n && chatRes.usage) {
          try {
            costMicrodollars = this.modelRegistry.calculateCost(modelId, chatRes.usage);
          } catch {
            costMicrodollars = 0n;
          }
        }
      } else if (
        "forward" in this.proxyClient &&
        typeof this.proxyClient.forward === "function"
      ) {
        const proxyRes = await this.proxyClient.forward({
          provider,
          model: modelId,
          decryptedKey: apiKey,
          body: JSON.stringify({
            model: modelId,
            messages: request.messages ?? [],
            stream: request.stream ?? false,
          }),
        });

        if (!proxyRes.response.ok) {
          const errText = await proxyRes.response.text().catch(() => "");
          throw new Error(
            `Upstream proxy error (HTTP ${proxyRes.response.status}): ${errText}`
          );
        }

        if (!request.stream) {
          const resText = await proxyRes.response.text();
          try {
            const parsed = JSON.parse(resText);
            content = extractContentFromPayload(parsed);
          } catch {
            content = resText;
          }
        }

        const usage: TokenUsage = await proxyRes.usagePromise;
        costMicrodollars = calculateCost(modelId, usage);
      } else {
        throw new Error("Configured proxy client does not implement 'chat' or 'forward' methods");
      }

      // 3. Tracks cost with KeyPoolContract.recordUsage
      if (costMicrodollars > 0n) {
        await this.keyPool.recordUsage(keyId, costMicrodollars);
      }

      // Record success result on KeyPool if supported
      if (typeof this.keyPool.recordResult === "function") {
        await this.keyPool.recordResult(keyId, true).catch(() => {});
      }

      const latencyMs = Date.now() - startTime;

      // 4. Emits telemetry via TelemetryContract (Non-blocking)
      if (this.telemetry) {
        try {
          const event: TelemetryEvent = {
            traceId,
            tenantId: this.tenantId,
            timestamp: startTime,
            eventType: "route_success",
            latencyMs,
            costMicrodollars,
            metadata: {
              model: modelId,
              modelAlias: request.modelAlias ?? "",
              provider,
              keyId,
              stream: String(Boolean(request.stream)),
            },
          };
          this.telemetry.emit(event);
        } catch {
          // Non-blocking telemetry invariant
        }
      }

      return {
        content,
        costMicrodollars,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;

      // Record failure on KeyPool if key was obtained
      if (keyId && typeof this.keyPool.recordResult === "function") {
        this.keyPool.recordResult(keyId, false).catch(() => {});
      }

      // Emit error telemetry (Non-blocking)
      if (this.telemetry) {
        try {
          const errorEvent: TelemetryEvent = {
            traceId,
            tenantId: this.tenantId,
            timestamp: startTime,
            eventType: "route_error",
            latencyMs,
            costMicrodollars: 0n,
            metadata: {
              model: modelId,
              modelAlias: request.modelAlias ?? "",
              provider,
              keyId,
              error: err instanceof Error ? err.message : String(err),
            },
          };
          this.telemetry.emit(errorEvent);
        } catch {
          // Non-blocking telemetry invariant
        }
      }

      throw err;
    }
  }
}

/**
 * Factory helper to create a RouterService.
 */
export function createRouterService(options: RouterServiceOptions): RouterService {
  return new RouterService(options);
}
