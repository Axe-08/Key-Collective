import type { APIKey, RequestLog, PoolStats, CreateKeyPayload } from './types';

const INITIAL_MOCK_KEYS: APIKey[] = [];

// In-memory state for fallback/mock simulation
let memoryKeys: APIKey[] = [];

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (typeof window !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token') || urlParams.get('admin_token');
      if (queryToken && queryToken.trim().length > 0) {
        localStorage.setItem('kc_auth_token', queryToken.trim());
      }
    } catch {
      // ignore
    }
    const token = localStorage.getItem('kc_auth_token');
    if (token && token.trim().length > 0) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }
  }
  return headers;
}

export const api = {
  async getKeys(): Promise<APIKey[]> {
    try {
      const res = await fetch('/api/keys', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch {
      // Backend not running or unreachable
    }
    return [];
  },

  async createKey(payload: CreateKeyPayload): Promise<APIKey> {
    const prefix = payload.key.slice(0, 8) || (payload.provider === 'gemini' ? 'AIzaSy' : 'gsk_');
    const suffix = payload.key.slice(-4) || '99xx';

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const newKey = await res.json();
        return newKey;
      }
    } catch {
      // Fallback
    }

    const newKey: APIKey = {
      id: `key_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      key_prefix: prefix,
      key_suffix: suffix,
      provider: payload.provider,
      label: payload.label.trim() || `${payload.provider}-key-${memoryKeys.length + 1}`,
      rpm_limit: payload.rpm_limit,
      rpd_limit: payload.rpd_limit,
      priority: payload.priority,
      status: 'healthy',
      requests_this_min: 0,
      requests_today: 0,
      total_requests: 0,
      avg_latency_ms: 0,
      created_at: new Date().toISOString(),
    };

    memoryKeys = [newKey, ...memoryKeys];
    return newKey;
  },

  async deleteKey(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        memoryKeys = memoryKeys.filter((k) => k.id !== id);
        return true;
      }
    } catch {
      // Fallback
    }

    memoryKeys = memoryKeys.filter((k) => k.id !== id);
    return true;
  },

  async testKey(id: string): Promise<{ success: boolean; latency_ms: number; message: string }> {
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Network or backend error
    }

    return { success: false, latency_ms: 0, message: 'Network or backend error testing key' };
  },

  async getLogs(): Promise<RequestLog[]> {
    try {
      const res = await fetch('/api/logs', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch {
      // Fallback
    }

    return [];
  },

  async getStats(keys: APIKey[], logs: RequestLog[]): Promise<PoolStats> {
    let backendStats: any = null;
    try {
      const res = await fetch('/api/stats', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        backendStats = await res.json();
      }
    } catch {
      // Fallback
    }

    const totalKeys = backendStats?.total_keys ?? backendStats?.active_keys ?? keys.length;
    const healthyKeys = backendStats?.healthy_keys ?? backendStats?.healthy_count ?? keys.filter((k) => k.status === 'healthy').length;
    const rateLimitedKeys = backendStats?.rate_limited_keys ?? backendStats?.rate_limited_count ?? keys.filter((k) => k.status === 'rate_limited').length;
    const invalidKeys = backendStats?.invalid_keys ?? keys.filter((k) => k.status === 'invalid').length;

    const totalRpmLimit = keys.reduce((acc, k) => acc + (k.status !== 'invalid' && k.status !== 'disabled' ? k.rpm_limit : 0), 0);
    const currentRpmUsed = keys.reduce((acc, k) => acc + (k.requests_this_min || 0), 0);
    const totalRpmHeadroom = Math.max(0, totalRpmLimit - currentRpmUsed);

    const validLogs = logs.filter((l) => l.status_code === 200);
    const avgLatency = validLogs.length > 0
      ? Math.round(validLogs.reduce((acc, l) => acc + l.latency_ms, 0) / validLogs.length)
      : backendStats?.avg_upstream_latency_ms ?? 0;

    const dailyQuotaUsed = backendStats?.total_requests_today ?? backendStats?.daily_quota_used ?? keys.reduce((acc, k) => acc + (k.requests_today || 0), 0);
    const dailyQuotaLimit = backendStats?.daily_quota_limit ?? (keys.reduce((acc, k) => acc + k.rpd_limit, 0) || 0);

    return {
      total_keys: totalKeys,
      healthy_keys: healthyKeys,
      rate_limited_keys: rateLimitedKeys,
      invalid_keys: invalidKeys,
      total_rpm_headroom: totalRpmHeadroom,
      total_rpm_limit: totalRpmLimit,
      current_rpm_used: currentRpmUsed,
      avg_upstream_latency_ms: avgLatency,
      daily_quota_used: dailyQuotaUsed,
      daily_quota_limit: dailyQuotaLimit,
      proxy_status: rateLimitedKeys === totalKeys && totalKeys > 0 ? 'degraded' : 'healthy',
    };
  },
};
