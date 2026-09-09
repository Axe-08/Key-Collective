import { describe, it, expect } from "vitest";
import {
  ApiRequest,
  ApiResponse,
  ApiResponseMeta,
  ApiErrorDetail,
  ApiErrorResponse,
  ApiSuccessResponse,
  ApiFailureResponse,
  ApiResult,
  PaginatedApiResponse,
  createApiRequest,
  createApiResponse,
  createApiErrorResponse,
  isApiRequest,
  isApiResponse,
  isApiErrorResponse,
} from "../src/types";

describe("API Types and Helpers", () => {
  describe("ApiRequest<T>", () => {
    it("correctly wraps payload and tenantId", () => {
      interface ChatPayload {
        messages: Array<{ role: string; content: string }>;
        model: string;
      }

      const payload: ChatPayload = {
        messages: [{ role: "user", content: "Hello world" }],
        model: "gemini-2.0-flash",
      };

      const request: ApiRequest<ChatPayload> = {
        tenantId: "tenant-abc-123",
        payload,
        body: payload,
        traceId: "trace-999",
        headers: { "x-request-id": "req-1" },
        params: { version: "v1" },
        timestamp: 1725890000000,
      };

      expect(request.tenantId).toBe("tenant-abc-123");
      expect(request.payload.model).toBe("gemini-2.0-flash");
      expect(request.payload.messages).toHaveLength(1);
      expect(request.body).toEqual(payload);
      expect(request.traceId).toBe("trace-999");
      expect(request.headers?.["x-request-id"]).toBe("req-1");
      expect(request.params?.version).toBe("v1");
      expect(request.timestamp).toBe(1725890000000);
    });

    it("creates an ApiRequest via createApiRequest factory", () => {
      const now = Date.now();
      const payload = { prompt: "Explain quantum computing" };
      const req = createApiRequest("tenant-xyz", payload, {
        traceId: "tr-100",
        headers: { authorization: "Bearer token" },
        params: { debug: "true" },
      });

      expect(req.tenantId).toBe("tenant-xyz");
      expect(req.payload).toEqual(payload);
      expect(req.body).toEqual(payload);
      expect(req.traceId).toBe("tr-100");
      expect(req.headers?.authorization).toBe("Bearer token");
      expect(req.params?.debug).toBe("true");
      expect(req.timestamp).toBeGreaterThanOrEqual(now);
    });
  });

  describe("ApiResponse<T>", () => {
    it("correctly encapsulates data and fixed-point microdollars meta", () => {
      interface GenerationResult {
        text: string;
        finishReason: string;
      }

      const meta: ApiResponseMeta = {
        latencyMs: 145,
        costMicrodollars: 1_250_000n, // $1.25 USD in int64 microdollars
        traceId: "trace-001",
        requestId: "req-001",
        timestamp: Date.now(),
        provider: "google",
        model: "gemini-2.0-flash",
        cached: false,
      };

      const response: ApiResponse<GenerationResult> = {
        data: {
          text: "Quantum computing harnesses superposition...",
          finishReason: "stop",
        },
        meta,
      };

      expect(response.data.finishReason).toBe("stop");
      expect(response.meta.latencyMs).toBe(145);
      expect(response.meta.costMicrodollars).toBe(1_250_000n);
      expect(typeof response.meta.costMicrodollars).toBe("bigint");
      expect(response.meta.provider).toBe("google");
      expect(response.meta.cached).toBe(false);
    });

    it("creates an ApiResponse via createApiResponse factory", () => {
      const meta: ApiResponseMeta = {
        latencyMs: 88,
        costMicrodollars: 500_000n,
        provider: "openai",
        model: "gpt-4o-mini",
      };

      const res = createApiResponse({ reply: "Hello there" }, meta);
      expect(res.data.reply).toBe("Hello there");
      expect(res.meta.latencyMs).toBe(88);
      expect(res.meta.costMicrodollars).toBe(500_000n);
    });

    it("supports serialized number costs when specified", () => {
      const meta: ApiResponseMeta<number> = {
        latencyMs: 50,
        costMicrodollars: 500,
      };
      const res: ApiResponse<{ status: string }, number> = {
        data: { status: "ok" },
        meta,
      };
      expect(res.meta.costMicrodollars).toBe(500);
    });
  });

  describe("ApiErrorResponse", () => {
    it("creates an ApiErrorResponse via createApiErrorResponse factory", () => {
      const errRes = createApiErrorResponse(
        "RATE_LIMIT_EXCEEDED",
        "Tenant RPM limit reached",
        { limit: 60, current: 61 },
        { latencyMs: 2, costMicrodollars: 0n }
      );

      expect(errRes.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(errRes.error.message).toBe("Tenant RPM limit reached");
      expect(errRes.error.details?.limit).toBe(60);
      expect(errRes.meta?.latencyMs).toBe(2);
      expect(errRes.meta?.costMicrodollars).toBe(0n);
    });

    it("creates error without details or meta", () => {
      const errRes = createApiErrorResponse("UNAUTHORIZED", "Missing token");
      expect(errRes.error.code).toBe("UNAUTHORIZED");
      expect(errRes.error.message).toBe("Missing token");
      expect(errRes.error.details).toBeUndefined();
      expect(errRes.meta).toBeUndefined();
    });
  });

  describe("ApiResult<T> Discriminated Union", () => {
    function processResult(result: ApiResult<{ answer: number }>): string {
      if (result.success) {
        return `Success: answer=${result.data.answer}, cost=${result.meta.costMicrodollars}`;
      } else {
        return `Error: ${result.error.code} - ${result.error.message}`;
      }
    }

    it("narrows to success type", () => {
      const successResult: ApiSuccessResponse<{ answer: number }> = {
        success: true,
        data: { answer: 42 },
        meta: { latencyMs: 12, costMicrodollars: 100n },
      };
      const output = processResult(successResult);
      expect(output).toBe("Success: answer=42, cost=100");
    });

    it("narrows to error type", () => {
      const failureResult: ApiFailureResponse = {
        success: false,
        error: { code: "CIRCUIT_OPEN", message: "Circuit breaker tripped" },
      };
      const output = processResult(failureResult);
      expect(output).toBe("Error: CIRCUIT_OPEN - Circuit breaker tripped");
    });
  });

  describe("PaginatedApiResponse<T>", () => {
    it("wraps arrays with pagination metadata", () => {
      const paginated: PaginatedApiResponse<{ id: string }> = {
        data: [{ id: "1" }, { id: "2" }],
        meta: {
          latencyMs: 15,
          costMicrodollars: 0n,
        },
        pagination: {
          page: 1,
          pageSize: 2,
          totalItems: 10,
          totalPages: 5,
          hasNextPage: true,
        },
      };

      expect(paginated.data).toHaveLength(2);
      expect(paginated.pagination.page).toBe(1);
      expect(paginated.pagination.hasNextPage).toBe(true);
      expect(paginated.meta.latencyMs).toBe(15);
    });
  });

  describe("Type Guards", () => {
    describe("isApiRequest", () => {
      it("validates well-formed ApiRequest objects", () => {
        expect(isApiRequest({ tenantId: "t1", payload: "data" })).toBe(true);
        expect(isApiRequest({ tenantId: "t1", body: "data" })).toBe(true);
        expect(isApiRequest({ tenantId: "t1", payload: {}, body: {} })).toBe(true);
      });

      it("rejects malformed requests", () => {
        expect(isApiRequest(null)).toBe(false);
        expect(isApiRequest(undefined)).toBe(false);
        expect(isApiRequest("string")).toBe(false);
        expect(isApiRequest(123)).toBe(false);
        expect(isApiRequest({ payload: "missing tenantId" })).toBe(false);
        expect(isApiRequest({ tenantId: 123, payload: "bad tenantId type" })).toBe(false);
        expect(isApiRequest({ tenantId: "t1" })).toBe(false);
      });
    });

    describe("isApiResponse", () => {
      it("validates well-formed ApiResponse objects", () => {
        expect(
          isApiResponse({
            data: { result: "ok" },
            meta: { latencyMs: 50, costMicrodollars: 1000n },
          })
        ).toBe(true);
        expect(
          isApiResponse({
            data: "simple string",
            meta: { latencyMs: 0, costMicrodollars: 0 },
          })
        ).toBe(true);
      });

      it("rejects malformed responses", () => {
        expect(isApiResponse(null)).toBe(false);
        expect(isApiResponse(undefined)).toBe(false);
        expect(isApiResponse({})).toBe(false);
        expect(isApiResponse({ data: "ok" })).toBe(false);
        expect(isApiResponse({ data: "ok", meta: null })).toBe(false);
        expect(isApiResponse({ data: "ok", meta: { latencyMs: "fast" } })).toBe(false);
        expect(isApiResponse({ data: "ok", meta: { latencyMs: 10 } })).toBe(false);
      });
    });

    describe("isApiErrorResponse", () => {
      it("validates well-formed ApiErrorResponse objects", () => {
        expect(
          isApiErrorResponse({
            error: { code: "NOT_FOUND", message: "Key not found" },
          })
        ).toBe(true);
        expect(
          isApiErrorResponse({
            error: { code: "ERR", message: "Failed", details: { foo: "bar" } },
            meta: { latencyMs: 1 },
          })
        ).toBe(true);
      });

      it("rejects malformed error responses", () => {
        expect(isApiErrorResponse(null)).toBe(false);
        expect(isApiErrorResponse(undefined)).toBe(false);
        expect(isApiErrorResponse({})).toBe(false);
        expect(isApiErrorResponse({ error: null })).toBe(false);
        expect(isApiErrorResponse({ error: { code: 123, message: "bad code" } })).toBe(false);
        expect(isApiErrorResponse({ error: { code: "ERR" } })).toBe(false);
      });
    });
  });
});
