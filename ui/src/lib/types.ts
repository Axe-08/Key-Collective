export type Provider = 'gemini' | 'groq';

export type KeyStatus = 'healthy' | 'rate_limited' | 'exhausted' | 'invalid' | 'disabled';

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
