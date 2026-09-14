export type Provider = 'gemini' | 'groq' | 'sambanova' | 'cerebras';

export type KeyStatus = 'healthy' | 'rate_limited' | 'exhausted' | 'invalid' | 'disabled';

export type PoolType = 'COMMUNITY' | 'PRIVATE';
export type CommunityRoutingStatus = 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED';

export interface APIKey {
  id: string;
  key_prefix: string;
  key_suffix: string;
  provider: Provider;
  label: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: KeyStatus;
  requests_this_min?: number;
  requests_today?: number;
  cooldown_until?: string | null;
  total_requests?: number;
  avg_latency_ms?: number;
  created_at?: string;
  pool_type?: PoolType;
  community_routing_status?: CommunityRoutingStatus;
  observation_until?: string | null;
  dispatched_today?: number;
  dispatched_communal?: number;
  vesting_tier?: 0 | 1 | 2;
}

export interface RequestLog {
  id: string;
  key_id: string;
  provider: Provider;
  status_code: number;
  latency_ms: number;
  bytes_in: number;
  bytes_out: number;
  created_at: string;
  model?: string;
}

export interface PoolStats {
  total_keys: number;
  healthy_keys: number;
  rate_limited_keys: number;
  invalid_keys: number;
  total_rpm_headroom: number;
  total_rpm_limit: number;
  current_rpm_used: number;
  avg_upstream_latency_ms: number;
  daily_quota_used: number;
  daily_quota_limit: number;
  proxy_status: 'healthy' | 'degraded' | 'offline';
}

export interface CreateKeyPayload {
  provider: Provider;
  label: string;
  key: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  pool_type: PoolType;
  k1: boolean;
  k2: boolean;
  turnstile_token: string;
}

export interface GlobalPoolTelemetry {
  total_active_keys: number;
  keys_in_observation: number;
  keys_quarantined: number;
  pool_utilization_percent: number;
  provider_pools: ProviderPoolMetrics[];
  snapshot_time: string;         // ISO timestamp
}

export interface ProviderPoolMetrics {
  provider: Provider;
  active_keys: number;
  quarantined_keys: number;
  observation_keys: number;
  u_pool_percent: number;        // 0–100
  w_provider: number;            // 0.0–1.0 quality weight
  p90_latency_ms: number;
  eye_for_eye_accessible: boolean;
}

export interface ContributorStanding {
  multiplier: number;
  multiplier_ceiling: number;
  community_debt_cu: number;
  daily_contributed_cu: number;
  trusted_contributor: boolean;
  jail_status: 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL';
  consecutive_debt_free_days: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

export type Microdollars = number; // int64 microdollars: 1 USD = 1,000,000 µ$

export function formatMicrodollars(amount: Microdollars): string {
  const usd = amount / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(usd);
}

export interface DebtEntry {
  id: string;
  amount: number; // int64 microdollars: 1 USD = 1,000,000 µ$
  description?: string;
  status?: 'pending' | 'resolved';
  createdAt?: string;
}
