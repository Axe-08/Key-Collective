/**
 * Key Collective v2/v4 — Model Discovery, OpenAPI, and Gateway Shield Routes
 */

import { timingSafeEqualStrings } from "../../crypto/utils";
import { ModelNotFoundError } from "../../errors/routing_errors";
import type { IModelRegistry } from "../../router/registry/index";
import { OPENAPI_SPEC } from "../openapi_spec";
import type { WorkerEnv } from "../auth/index";

export class ModelRoutesHandler {
  /**
   * Public health check bypass endpoint.
   */
  public handleHealth(startTime: number): Response {
    return Response.json({
      status: "healthy",
      version: "0.2.0",
      runtime: "cloudflare-workers",
      timestamp: new Date(startTime).toISOString(),
    });
  }

  /**
   * Gateway takedown & abuse reporting endpoint with constant-time timing shield.
   */
  public async handleReport(request: Request, env: WorkerEnv): Promise<Response> {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const expectedSecret = env.REPORT_WEBHOOK_SECRET || "";

    if (!token || !expectedSecret || !timingSafeEqualStrings(token, expectedSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return Response.json({ success: true, message: "Report accepted" });
  }

  /**
   * Returns OpenAPI specification JSON.
   */
  public handleOpenApiSpec(): Response {
    return Response.json(OPENAPI_SPEC, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      },
    });
  }

  /**
   * Returns available models in OpenAI-compatible format: GET /v1/models.
   */
  public handleListModels(_request: Request, modelRegistry: IModelRegistry): Response {
    const models = modelRegistry.getAllModels(true).map((m) => ({
      id: m.id,
      object: "model",
      created: 1726000000,
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null,
      context_window: m.contextWindow,
      max_output_tokens: m.maxOutputTokens,
      capabilities: {
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsJsonSchema: m.supportsJsonSchema,
      },
      pricing: {
        input_cost_per_mtok_micro: m.inputCostPerMTokMicro.toString(),
        output_cost_per_mtok_micro: m.outputCostPerMTokMicro.toString(),
        cache_read_cost_per_mtok_micro: m.cacheReadCostPerMTokMicro.toString(),
      },
      deprecated: Boolean(m.deprecatedAt),
      deprecated_at: m.deprecatedAt,
      sunset_at: m.sunsetAt,
    }));

    return Response.json(
      {
        object: "list",
        data: models,
      },
      {
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }

  /**
   * Returns a single model detail by ID or alias: GET /v1/models/:id.
   */
  public handleGetModel(_request: Request, modelId: string, modelRegistry: IModelRegistry): Response {
    const model = modelRegistry.resolveModel(modelId);
    if (!model) {
      throw new ModelNotFoundError(modelId, `Model '${modelId}' not found in registry`);
    }

    return Response.json(
      {
        id: model.id,
        object: "model",
        created: 1726000000,
        owned_by: model.provider,
        permission: [],
        root: model.id,
        parent: null,
        context_window: model.contextWindow,
        max_output_tokens: model.maxOutputTokens,
        capabilities: {
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
          supportsJsonSchema: model.supportsJsonSchema,
        },
        pricing: {
          input_cost_per_mtok_micro: model.inputCostPerMTokMicro.toString(),
          output_cost_per_mtok_micro: model.outputCostPerMTokMicro.toString(),
          cache_read_cost_per_mtok_micro: model.cacheReadCostPerMTokMicro.toString(),
        },
        deprecated: Boolean(model.deprecatedAt),
        deprecated_at: model.deprecatedAt,
        sunset_at: model.sunsetAt,
      },
      {
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }
}
