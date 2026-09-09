/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Generic API Request & Response Types
 * 
 * Invariants:
 * - Strict mode, no `any`.
 * - Fixed-point microdollars (int64 microdollars, 1 USD = 1,000,000 µ$).
 * - Multi-tenant isolation: requests wrap incoming payload with extracted tenantId.
 */

/**
 * Metadata attached to structured API responses.
 * By default, `costMicrodollars` is typed as `bigint` to enforce zero floating-point math.
 */
export interface ApiResponseMeta<TCost = bigint> {
  /** Execution latency in milliseconds */
  latencyMs: number;
  /** Fixed-point cost in microdollars (int64 BigInt by default) */
  costMicrodollars: TCost;
  /** Unique distributed trace identifier */
  traceId?: string;
  /** Internal request identifier */
  requestId?: string;
  /** Unix timestamp (ms) of response completion */
  timestamp?: number;
  /** Resolved upstream model provider (e.g. "openai", "anthropic", "google") */
  provider?: string;
  /** Resolved model identifier (e.g. "gemini-2.0-flash") */
  model?: string;
  /** Indicates whether the response was served from cache */
  cached?: boolean;
}

/**
 * Standard structured JSON response format as defined in LLD 2.1:
 * `{ data: T, meta: { latencyMs, costMicrodollars, ... } }`
 */
export interface ApiResponse<T, TCost = bigint> {
  /** Response payload */
  data: T;
  /** Structured response metadata */
  meta: ApiResponseMeta<TCost>;
}

/**
 * Options for initializing an ApiRequest.
 */
export interface ApiRequestOptions<T = unknown> {
  body?: T;
  traceId?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timestamp?: number;
}

/**
 * Standard structured API request wrapper as defined in LLD 2.1:
 * Wraps the incoming JSON payload and includes `tenantId` (extracted from the authenticated AuthContext).
 */
export interface ApiRequest<T = unknown> {
  /** Tenant ID extracted from the authenticated AuthContext */
  tenantId: string;
  /** Incoming JSON payload */
  payload: T;
  /** Optional body alias for the incoming JSON payload */
  body?: T;
  /** Optional distributed trace identifier */
  traceId?: string;
  /** Optional incoming HTTP headers */
  headers?: Record<string, string>;
  /** Optional route / query parameters */
  params?: Record<string, string>;
  /** Edge receipt timestamp */
  timestamp?: number;
}

/**
 * Structured error details returned on API failures.
 */
export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard structured API error response wrapper.
 */
export interface ApiErrorResponse<TCost = bigint> {
  error: ApiErrorDetail;
  meta?: Partial<ApiResponseMeta<TCost>>;
}

/**
 * Discriminated union member for successful API response.
 */
export interface ApiSuccessResponse<T, TCost = bigint> {
  success: true;
  data: T;
  meta: ApiResponseMeta<TCost>;
}

/**
 * Discriminated union member for failed API response.
 */
export interface ApiFailureResponse<TCost = bigint> {
  success: false;
  error: ApiErrorDetail;
  meta?: Partial<ApiResponseMeta<TCost>>;
}

/**
 * Discriminated result type for API operations.
 */
export type ApiResult<T, TCost = bigint> = ApiSuccessResponse<T, TCost> | ApiFailureResponse<TCost>;

/**
 * Pagination metadata for collection endpoints.
 */
export interface ApiPaginationMeta {
  page: number;
  pageSize: number;
  totalItems?: number;
  totalPages?: number;
  hasNextPage: boolean;
}

/**
 * Paginated API response wrapper.
 */
export interface PaginatedApiResponse<T, TCost = bigint> extends ApiResponse<T[], TCost> {
  pagination: ApiPaginationMeta;
}

/**
 * Factory to create an ApiRequest wrapping incoming payload and tenant context.
 */
export function createApiRequest<T>(
  tenantId: string,
  payload: T,
  options?: ApiRequestOptions<T>
): ApiRequest<T> {
  return {
    tenantId,
    payload,
    body: options?.body ?? payload,
    traceId: options?.traceId,
    headers: options?.headers,
    params: options?.params,
    timestamp: options?.timestamp ?? Date.now(),
  };
}

/**
 * Factory to create a standard ApiResponse with data and meta.
 */
export function createApiResponse<T, TCost = bigint>(
  data: T,
  meta: ApiResponseMeta<TCost>
): ApiResponse<T, TCost> {
  return {
    data,
    meta,
  };
}

/**
 * Factory to create an ApiErrorResponse.
 */
export function createApiErrorResponse<TCost = bigint>(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  meta?: Partial<ApiResponseMeta<TCost>>
): ApiErrorResponse<TCost> {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    ...(meta !== undefined ? { meta } : {}),
  };
}

/**
 * Type guard for ApiRequest.
 */
export function isApiRequest<T = unknown>(value: unknown): value is ApiRequest<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenantId === "string" &&
    ("payload" in candidate || "body" in candidate)
  );
}

/**
 * Type guard for ApiResponse.
 */
export function isApiResponse<T = unknown>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!("data" in candidate) || typeof candidate.meta !== "object" || candidate.meta === null) {
    return false;
  }
  const meta = candidate.meta as Record<string, unknown>;
  const hasValidCost =
    typeof meta.costMicrodollars === "bigint" || typeof meta.costMicrodollars === "number";
  return typeof meta.latencyMs === "number" && hasValidCost;
}

/**
 * Type guard for ApiErrorResponse.
 */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!("error" in candidate) || typeof candidate.error !== "object" || candidate.error === null) {
    return false;
  }
  const errorObj = candidate.error as Record<string, unknown>;
  return typeof errorObj.code === "string" && typeof errorObj.message === "string";
}
