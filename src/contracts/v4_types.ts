import { z } from "zod";

export const ConsentAttestationSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  consent_type: z.enum(["C1", "C2", "C3", "K1", "K2"]),
  consent_version: z.string().min(1),
  attested_at: z.number().int().positive(),
});

export type ConsentAttestation = z.infer<typeof ConsentAttestationSchema>;

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  label: z.string().min(1).max(100),
  provider: z.enum(["gemini", "groq", "sambanova", "cerebras", "openai", "anthropic"]),
  pool_type: z.enum(["PRIVATE", "COMMUNITY"]),
  community_routing_status: z.enum(["OBSERVATION", "ACTIVE", "QUARANTINED", "REVOKED"]),
  project_hash_state: z.enum(["ACTIVE", "ROTATING", "TOMBSTONED"]),
  vesting_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  observation_until: z.number().int().positive().nullable(),
  rotating_until: z.number().int().positive().nullable(),
  gcp_project_hash: z.string().length(64).nullable(),
  encrypted_key_material: z.string().min(1),
  nonce: z.string().min(16),
  created_at: z.number().int().positive(),
  rpm_limit: z.number().int().positive().nullable(),
  rpd_limit: z.number().int().positive().nullable(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CommunityDebtLedgerSchema = z.object({
  tenant_id: z.string().min(1),
  community_debt_micro_cu: z.number().int().nonnegative(),
  daily_free_draw_micro_cu: z.number().int().nonnegative(),
  daily_consumed_from_pool_micro_cu: z.number().int().nonnegative(),
  last_decay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jail_status: z.enum(["PRISTINE", "SOFT_WARNING", "HARD_JAIL"]),
  trusted_contributor_streak_days: z.number().int().nonnegative(),
  updated_at: z.number().int().positive(),
});

export type CommunityDebtLedger = z.infer<typeof CommunityDebtLedgerSchema>;

export const ContributorStandingSchema = z.object({
  tenant_id: z.string().min(1),
  current_multiplier: z.number().min(1.0).max(4.5),
  is_trusted_contributor: z.boolean(),
  jail_status: z.enum(["PRISTINE", "SOFT_WARNING", "HARD_JAIL"]),
  debt_threshold_ratio: z.number().min(0),
});

export type ContributorStanding = z.infer<typeof ContributorStandingSchema>;

export const RoutingDecisionSchema = z.object({
  route_type: z.enum([
    "SELF_KEY",
    "COMMUNITY_POOL",
    "QUOTA_JAIL_REJECT",
    "DEMO_POOL",
    "PROVIDER_NOT_CONTRIBUTED",
    "POOL_EMPTY",
  ]),
  selected_key_id: z.string().uuid().optional(),
  selected_provider: z.enum(["gemini", "groq", "sambanova", "cerebras", "openai", "anthropic"]).optional(),
  cu_cost_micro: z.number().int().nonnegative(),
  routing_overhead_ms: z.number().nonnegative(),
  reject_reason: z.string().optional(),
});

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const TakedownReportSchema = z.object({
  leaked_key: z.string().min(10).max(512),
  turnstile_token: z.string().min(1),
  source_url: z.string().url().optional(),
});

export type TakedownReport = z.infer<typeof TakedownReportSchema>;

export const PoolMetricsSchema = z.object({
  total_active_keys: z.number().int().nonnegative(),
  keys_by_provider: z.record(z.string(), z.number().int().nonnegative()),
  pool_health_ratio: z.number().min(0).max(1),
  keys_in_observation: z.number().int().nonnegative(),
  keys_quarantined: z.number().int().nonnegative(),
  provider_quality_weights: z.record(z.string(), z.number().min(0).max(1)),
  snapshot_time: z.number().int().positive(),
  active_tenants_5min: z.number().int().nonnegative(),
});

export type PoolMetrics = z.infer<typeof PoolMetricsSchema>;

export const ProjectHashRegistrySchema = z.object({
  gcp_project_hash: z.string().length(64),
  state: z.enum(["ACTIVE", "ROTATING", "TOMBSTONED"]),
  tombstoned_at: z.number().int().positive().nullable(),
  tenant_id: z.string().min(1),
  created_at: z.number().int().positive(),
});

export type ProjectHashRegistry = z.infer<typeof ProjectHashRegistrySchema>;
