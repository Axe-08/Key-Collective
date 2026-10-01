import { z } from 'zod';
import type { APIKey, RequestLog, PoolStats, CreateKeyPayload } from './types';
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
      sybil_score?: number;
      githubUsername?: string;
      avatarUrl?: string;
    } | null;
    csrfToken?: string;
    notices?: string[];
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
};
