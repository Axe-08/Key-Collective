import { z } from 'zod';
import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, NotificationItem } from './types';
import { request, sessionAuthTransport, setCsrfToken } from './api/client';
import {
  KeysListResponseSchema,
  LogsListResponseSchema,
  KeyResponseSchema,
  KeyTestResponseSchema,
  PoolStatsSchema,
  ProjectRecordSchema,
  ProjectsListResponseSchema,
  TokensListResponseSchema,
  IssuedTokenSchema,
  type ProjectRecord,
  type TokenSummary,
  type IssuedToken,
} from '../../../src/contracts/api/responses';

const DeleteKeyResponseSchema = z.unknown();

/** Fetch options for a console call: session cookie, plus the CSRF header on mutations. */
function sessionInit(method = 'GET'): RequestInit {
  return { method, headers: sessionAuthTransport.getHeaders(method), credentials: 'same-origin' };
}

export const api = {
  async getKeys(): Promise<APIKey[]> {
    return request(KeysListResponseSchema, '/api/keys');
  },

  async createKey(payload: CreateKeyPayload): Promise<APIKey> {
    // The server reads the Turnstile token from x-turnstile-token, never the body.
    const { turnstile_token, ...body } = payload;
    return request(KeyResponseSchema, '/api/keys', {
      method: 'POST',
      headers: { 'x-turnstile-token': turnstile_token },
      body: JSON.stringify(body),
    });
  },

  async deleteKey(id: string): Promise<boolean> {
    await request(DeleteKeyResponseSchema, `/api/keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return true;
  },

  async testKey(id: string): Promise<{ success: boolean; latency_ms: number; message: string }> {
    return request(KeyTestResponseSchema, `/api/keys/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  },

  async getLogs(): Promise<RequestLog[]> {
    return request(LogsListResponseSchema, '/api/logs');
  },

  async getStats(): Promise<PoolStats> {
    return request(PoolStatsSchema, '/api/stats');
  },

  // --- Projects and API keys (WP-3.9): cookie session + CSRF via request() ---

  async getProjects(): Promise<ProjectRecord[]> {
    return request(ProjectsListResponseSchema, '/api/projects');
  },

  async createProject(payload: { name: string; description?: string }): Promise<ProjectRecord> {
    return request(ProjectRecordSchema, '/api/projects', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** Pessimistic: resolves only after the server stored the change (throws ApiError otherwise). */
  async updateProject(
    id: string,
    payload: { name?: string; description?: string | null; is_archived?: boolean; rpm_sub_cap?: number | null }
  ): Promise<ProjectRecord> {
    return request(ProjectRecordSchema, `/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteProject(id: string): Promise<boolean> {
    await request(DeleteKeyResponseSchema, `/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  },

  async getTokens(): Promise<TokenSummary[]> {
    return request(TokensListResponseSchema, '/api/tokens');
  },

  async createToken(payload: { project_id?: string; rpm_limit?: number }): Promise<IssuedToken> {
    return request(IssuedTokenSchema, '/api/tokens', { method: 'POST', body: JSON.stringify(payload) });
  },

  async rotateToken(id: string): Promise<IssuedToken> {
    return request(IssuedTokenSchema, `/api/tokens/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
  },

  async revokeToken(id: string): Promise<boolean> {
    await request(DeleteKeyResponseSchema, `/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  },

  async setKeyPoolMode(id: string, poolType: 'COMMUNITY' | 'PRIVATE') {
    return request(z.object({ pool_type: z.enum(['COMMUNITY', 'PRIVATE']), community_routing_status: z.string().nullable(), observation_until: z.number().nullable() }).passthrough(),
      `/api/keys/${encodeURIComponent(id)}/pool-mode`, { method: 'PATCH', body: JSON.stringify({ pool_type: poolType }) });
  },

  async rotateProviderKey(id: string, newKey: string) {
    return request(z.object({ key_prefix: z.string(), key_suffix: z.string() }).passthrough(),
      `/api/keys/${encodeURIComponent(id)}/rotate`, { method: 'POST', body: JSON.stringify({ new_key: newKey }) });
  },

  async getAdminTenants(): Promise<{ tenants: any[]; pool?: any }> {
    try {
      const res = await fetch('/api/admin/tenants', sessionInit());
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return { tenants: [] };
  },

  async updateTenantTier(tenantId: string, newTier: string, reason?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/tier`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ new_tier: newTier, reason }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async quarantineTenant(tenantId: string, isQuarantined: boolean, reason?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/quarantine`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ is_quarantined: isQuarantined, reason }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async resetTenantQuota(tenantId: string, reason?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/reset-quota`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ reason }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getAdminAuditLogs(limit = 50, offset = 0): Promise<{
    events: Array<{
      id: string;
      admin_user_id: string | null;
      admin_email: string;
      action: string;
      target: string;
      details_json: string;
      ip_address: string;
      created_at: number;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const res = await fetch(`/api/admin/audit?limit=${limit}&offset=${offset}`, sessionInit('GET'));
    if (!res.ok) {
      throw new Error(`Failed to fetch audit logs: ${res.status}`);
    }
    return res.json();
  },

  async updateKeyRoutingStatus(keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION', reason?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}/routing-status`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ status, reason }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async updateKeyPoolMode(keyId: string, poolType: 'COMMUNITY' | 'PRIVATE'): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}/pool-mode`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ pool_type: poolType }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async adminDeleteKey(keyId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
        ...sessionInit('DELETE'),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async manageCommunityPool(action: 'ACTIVATE_ALL_OBSERVATION' | 'PURGE_QUARANTINED' | 'RESET_ALL_DEBT'): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/pool/manage', {
        ...sessionInit('POST'),
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getSession(): Promise<{
    user?: {
      id: string;
      email?: string;
      tier?: string;
      role?: string;
      sybil_score?: number | null;
      providers?: string[];
      github_id?: string | null;
      github_username?: string | null;
      avatarUrl?: string;
    } | null;
    csrfToken?: string;
    notices?: string[];
    rights?: { privatePool: boolean; communityPool: boolean };
  } | null> {
    try {
      const res = await fetch('/api/session', sessionInit());
      if (res.ok) {
        const body = await res.json();
        setCsrfToken(body?.csrfToken ?? null);
        return body;
      }
    } catch {
      // offline / error fallback
    }
    return null;
  },

  async toggleUserPoolMode(
    keyId: string,
    poolType: 'COMMUNITY' | 'PRIVATE'
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}/pool-mode`, {
        ...sessionInit('PATCH'),
        body: JSON.stringify({ pool_type: poolType }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return {
          ok: false,
          error: errBody?.error?.code || errBody?.error || 'FAILED',
          message: errBody?.error?.message || errBody?.message || 'Pool mode change failed',
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'NETWORK_ERROR', message: 'Network error' };
    }
  },

  async rotateKeySecret(
    keyId: string,
    newSecret: string
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}/rotate`, {
        ...sessionInit('POST'),
        body: JSON.stringify({ secret: newSecret }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return {
          ok: false,
          message: errBody?.error?.message || errBody?.message || 'Key rotation failed',
        };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: 'Network error while rotating key' };
    }
  },

  async getAnalyticsUsage(): Promise<{
    usage: Array<{
      day: string;
      provider: string;
      model: string;
      requests: number;
      tokens: number;
      cu: number;
    }>;
  }> {
    const res = await fetch('/api/analytics/usage', sessionInit());
    if (!res.ok) return { usage: [] };
    return res.json();
  },

  async getAnalyticsLedger(
    limit = 50,
    offset = 0
  ): Promise<{
    items: Array<{
      id: string;
      key_id: string;
      provider: string;
      model_id: string;
      cu: number | null;
      prompt_tokens: number;
      completion_tokens: number;
      latency_ms: number;
      status_code: number;
      borrowed: number;
      created_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const res = await fetch(`/api/analytics/ledger?limit=${limit}&offset=${offset}`, sessionInit());
    if (!res.ok) return { items: [], total: 0, limit, offset };
    return res.json();
  },

  async getAnalyticsMultiplierHistory(): Promise<{
    history: Array<{
      day: string;
      multiplier_pct: number;
      debt_cu: number;
      contributed_cu_24h: number;
      jail_status: string;
    }>;
  }> {
    const res = await fetch('/api/analytics/multiplier-history', sessionInit());
    if (!res.ok) return { history: [] };
    return res.json();
  },

  /** GET /api/notifications answers { notifications }; signed out (401) means none. */
  async getNotifications(since = 0): Promise<{ notifications: NotificationItem[] }> {
    const res = await fetch(`/api/notifications?since=${since}`, sessionInit());
    if (res.status === 401) return { notifications: [] };
    if (!res.ok) throw new Error(`Notifications request failed (${res.status})`);
    const body = (await res.json()) as { notifications?: NotificationItem[] };
    return { notifications: Array.isArray(body.notifications) ? body.notifications : [] };
  },

  async markNotificationRead(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        ...sessionInit('POST'),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

