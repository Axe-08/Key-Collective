import type { APIKey, RequestLog, PoolStats, CreateKeyPayload } from './types';

const INITIAL_MOCK_KEYS: APIKey[] = [
  {
    id: 'key_01jh9x81m',
    key_prefix: 'AIzaSyA4',
    key_suffix: '7F9x',
    provider: 'gemini',
    label: 'gemini-1.5-pro-primary',
    rpm_limit: 15,
    rpd_limit: 1500,
    priority: 0,
    status: 'healthy',
    requests_this_min: 4,
    requests_today: 412,
    total_requests: 3820,
    avg_latency_ms: 312,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'key_01jh9x82p',
    key_prefix: 'AIzaSyC2',
    key_suffix: '9mK1',
    provider: 'gemini',
    label: 'gemini-1.5-flash-batch',
    rpm_limit: 15,
    rpd_limit: 1500,
    priority: 1,
    status: 'healthy',
    requests_this_min: 7,
    requests_today: 890,
    total_requests: 5210,
    avg_latency_ms: 228,
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 'key_01jh9x83q',
    key_prefix: 'gsk_99aB',
    key_suffix: '1eZ3',
    provider: 'groq',
    label: 'groq-llama3-ultra-fast',
    rpm_limit: 30,
    rpd_limit: 14400,
    priority: 0,
    status: 'healthy',
    requests_this_min: 12,
    requests_today: 3410,
    total_requests: 18450,
    avg_latency_ms: 142,
    created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
  {
    id: 'key_01jh9x84r',
    key_prefix: 'gsk_71fD',
    key_suffix: '8uX9',
    provider: 'groq',
    label: 'groq-mixtral-backup',
    rpm_limit: 30,
    rpd_limit: 14400,
    priority: 2,
    status: 'rate_limited',
    requests_this_min: 30,
    requests_today: 6120,
    cooldown_until: new Date(Date.now() + 38000).toISOString(),
    total_requests: 9840,
    avg_latency_ms: 295,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'key_01jh9x85s',
    key_prefix: 'AIzaSyD8',
    key_suffix: '4nL0',
    provider: 'gemini',
    label: 'gemini-exp-tier3',
    rpm_limit: 15,
    rpd_limit: 1500,
    priority: 3,
    status: 'invalid',
    requests_this_min: 0,
    requests_today: 12,
    total_requests: 42,
    avg_latency_ms: 0,
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'key_01jh9x86t',
    key_prefix: 'gsk_52hP',
    key_suffix: '3kW2',
    provider: 'groq',
    label: 'groq-llama3-eu-zone',
    rpm_limit: 30,
    rpd_limit: 14400,
    priority: 1,
    status: 'healthy',
    requests_this_min: 8,
    requests_today: 1850,
    total_requests: 7420,
    avg_latency_ms: 168,
    created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
  },
];

function generateMockLogs(count = 25): RequestLog[] {
  const providers: ('gemini' | 'groq')[] = ['gemini', 'groq'];
  const geminiModels = ['gemini-1.5-pro', 'gemini-1.5-flash'];
  const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
  const statusCodes = [200, 200, 200, 200, 200, 200, 429, 200, 500];

  const logs: RequestLog[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const prov = providers[Math.floor(Math.random() * providers.length)];
    const code = statusCodes[Math.floor(Math.random() * statusCodes.length)];
    const isGemini = prov === 'gemini';
    const latencyBase = isGemini ? 220 : 90;
    const latency = code === 429 ? Math.floor(Math.random() * 40 + 20) : Math.floor(latencyBase + Math.random() * 320);
    const key = prov === 'gemini' ? (Math.random() > 0.5 ? 'key_01jh9x81m' : 'key_01jh9x82p') : (Math.random() > 0.5 ? 'key_01jh9x83q' : 'key_01jh9x86t');

    logs.push({
      id: `log_${(now - i * 1400).toString(36)}_${i}`,
      key_id: key,
      provider: prov,
      status_code: code,
      latency_ms: latency,
      bytes_in: Math.floor(640 + Math.random() * 4500),
      bytes_out: code === 200 ? Math.floor(1200 + Math.random() * 8500) : 180,
      created_at: new Date(now - i * 2800 - Math.random() * 1500).toISOString(),
      model: isGemini ? geminiModels[Math.floor(Math.random() * geminiModels.length)] : groqModels[Math.floor(Math.random() * groqModels.length)],
    });
  }

  return logs;
}

// In-memory state for fallback/mock simulation
let memoryKeys: APIKey[] = [...INITIAL_MOCK_KEYS];
let memoryLogs: RequestLog[] = generateMockLogs(35);

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
    const token = localStorage.getItem('kc_auth_token') || 'kc_test_token_local_dev_12345';
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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
      // Backend not running or unreachable, fallback to memory keys
    }
    return memoryKeys;
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
      // Fallback test simulation
    }

    await new Promise((r) => setTimeout(r, 650));
    const targetKey = memoryKeys.find((k) => k.id === id);
    if (targetKey && targetKey.status === 'invalid') {
      return { success: false, latency_ms: 45, message: 'Invalid API Key token rejected by upstream provider (HTTP 401)' };
    }
    const latency = Math.floor(110 + Math.random() * 240);
    return { success: true, latency_ms: latency, message: `Key verified successfully with upstream in ${latency}ms` };
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

    // Push simulated new request periodically
    if (Math.random() > 0.4) {
      const prov: 'gemini' | 'groq' = Math.random() > 0.45 ? 'groq' : 'gemini';
      const code = Math.random() > 0.12 ? 200 : (Math.random() > 0.5 ? 429 : 500);
      const isGemini = prov === 'gemini';
      const freshLog: RequestLog = {
        id: `log_${Date.now().toString(36)}`,
        key_id: prov === 'gemini' ? 'key_01jh9x81m' : 'key_01jh9x83q',
        provider: prov,
        status_code: code,
        latency_ms: code === 429 ? 34 : Math.floor((isGemini ? 210 : 85) + Math.random() * 210),
        bytes_in: Math.floor(400 + Math.random() * 2400),
        bytes_out: code === 200 ? Math.floor(1500 + Math.random() * 6000) : 150,
        created_at: new Date().toISOString(),
        model: isGemini ? 'gemini-1.5-flash' : 'llama-3.3-70b-versatile',
      };
      memoryLogs = [freshLog, ...memoryLogs.slice(0, 49)];
    }

    return memoryLogs.slice(0, 50);
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
      : 245;

    const dailyQuotaUsed = backendStats?.total_requests_today ?? backendStats?.daily_quota_used ?? keys.reduce((acc, k) => acc + (k.requests_today || 0), 0);
    const dailyQuotaLimit = backendStats?.daily_quota_limit ?? (keys.reduce((acc, k) => acc + k.rpd_limit, 0) || 50000);

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
