import { z } from 'zod';

// Response contracts for /api/* endpoints consumed by the UI.
// These validate the shapes defined in ui/src/lib/types.ts.

export const ProviderSchema = z.enum(['gemini', 'groq', 'sambanova', 'cerebras']);
export type Provider = z.infer<typeof ProviderSchema>;

export const KeyStatusSchema = z.enum(['healthy', 'rate_limited', 'exhausted', 'invalid', 'disabled']);
export type KeyStatus = z.infer<typeof KeyStatusSchema>;

export const PoolTypeSchema = z.enum(['COMMUNITY', 'PRIVATE']);
export type PoolType = z.infer<typeof PoolTypeSchema>;

export const CommunityRoutingStatusSchema = z.enum([
  'OBSERVATION',
  'ACTIVE',
  'QUARANTINED',
  'REVOKED',
]);
export type CommunityRoutingStatus = z.infer<typeof CommunityRoutingStatusSchema>;

export const APIKeySchema = z.object({
  id: z.string(),
  key_prefix: z.string(),
  key_suffix: z.string(),
  provider: ProviderSchema,
  label: z.string(),
  rpm_limit: z.number(),
  rpd_limit: z.number(),
  priority: z.number(),
  status: KeyStatusSchema,
  requests_this_min: z.number().optional(),
  requests_today: z.number().optional(),
  cooldown_until: z.string().nullable().optional(),
  total_requests: z.number().optional(),
  avg_latency_ms: z.number().optional(),
  created_at: z.string().optional(),
  pool_type: PoolTypeSchema.optional(),
  community_routing_status: CommunityRoutingStatusSchema.optional(),
  observation_until: z.string().nullable().optional(),
  dispatches_today: z.number().optional(),
  dispatches_communal: z.number().optional(),
  tenant_id: z.string().optional(),
  is_owner: z.boolean().optional(),
});
export type APIKey = z.infer<typeof APIKeySchema>;

// GET /api/keys
export const KeysListResponseSchema = z.array(APIKeySchema);
export type KeysListResponse = z.infer<typeof KeysListResponseSchema>;

// POST /api/keys (create), and general "single key" shape
export const KeyResponseSchema = APIKeySchema;
export type KeyResponse = z.infer<typeof KeyResponseSchema>;

// POST /api/keys/:id/test
export const KeyTestResponseSchema = z.object({
  success: z.boolean(),
  latency_ms: z.number(),
  message: z.string(),
  /** Proof-of-life verdict (WP-3.8). */
  ok: z.boolean().optional(),
  status: z.enum(["healthy", "no_quota", "invalid", "unavailable"]).optional(),
});
export type KeyTestResponse = z.infer<typeof KeyTestResponseSchema>;

export const RequestLogSchema = z.object({
  id: z.string(),
  key_id: z.string(),
  provider: ProviderSchema,
  status_code: z.number(),
  latency_ms: z.number(),
  bytes_in: z.number(),
  bytes_out: z.number(),
  created_at: z.string(),
  model: z.string().optional(),
});
export type RequestLog = z.infer<typeof RequestLogSchema>;

// GET /api/logs
export const LogsListResponseSchema = z.array(RequestLogSchema);
export type LogsListResponse = z.infer<typeof LogsListResponseSchema>;

// GET /api/stats
export const PoolStatsSchema = z.object({
  total_keys: z.number(),
  healthy_keys: z.number(),
  rate_limited_keys: z.number(),
  invalid_keys: z.number(),
  total_rpm_headroom: z.number(),
  total_rpm_limit: z.number(),
  current_rpm_used: z.number(),
  avg_upstream_latency_ms: z.number(),
  daily_quota_used: z.number(),
  daily_quota_limit: z.number(),
  proxy_status: z.enum(['healthy', 'degraded', 'offline']),
  cu_used_today: z.number(),
  cu_allowance_today: z.number(),
});
export type PoolStats = z.infer<typeof PoolStatsSchema>;

// --- Projects and project-scoped API keys (WP-3.7 / WP-3.9) ---

export const ProjectRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tenant_id: z.string().optional(),
    description: z.string().nullable().optional(),
    rpm_sub_cap: z.number().nullable().optional(),
    is_archived: z.union([z.boolean(), z.number()]).optional(),
    created_at: z.number().optional(),
    updated_at: z.number().optional(),
  })
  .passthrough();
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export const ProjectsListResponseSchema = z.array(ProjectRecordSchema);

export const TokenSummarySchema = z
  .object({
    id: z.string(),
    tenant_id: z.string().optional(),
    project_id: z.string().nullable().optional(),
    rpm_limit: z.number().optional(),
    created_at: z.string().optional(),
    expires_at: z.string().nullable().optional(),
    hash_masked: z.string().optional(),
  })
  .passthrough();
export type TokenSummary = z.infer<typeof TokenSummarySchema>;
export const TokensListResponseSchema = z.array(TokenSummarySchema);

/** POST /api/tokens and POST /api/tokens/:id/rotate: the secret is shown once. */
export const IssuedTokenSchema = TokenSummarySchema.extend({ token: z.string() });
export type IssuedToken = z.infer<typeof IssuedTokenSchema>;
