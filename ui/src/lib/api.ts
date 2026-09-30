import { z } from 'zod';
import type { APIKey, RequestLog, PoolStats, CreateKeyPayload } from './types';
import { request } from './api/client';
import {
  KeysListResponseSchema,
  LogsListResponseSchema,
  KeyResponseSchema,
  KeyTestResponseSchema,
  PoolStatsSchema,
} from '../../../src/contracts/api/responses';

const DeleteKeyResponseSchema = z.unknown();

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('kc_auth_token');
    if (token && token.trim().length > 0) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }
  }
  return headers;
}

export const api = {
  async getKeys(): Promise<APIKey[]> {
    return request(KeysListResponseSchema, '/api/keys');
  },

  async createKey(payload: CreateKeyPayload): Promise<APIKey> {
    return request(KeyResponseSchema, '/api/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
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

  async getAdminTenants(): Promise<{ tenants: any[]; pool?: any }> {
    try {
      const res = await fetch('/api/admin/tenants', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return { tenants: [] };
  },

  async updateTenantTier(tenantId: string, newTier: string, reason?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/tier`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
        method: 'POST',
        headers: getAuthHeaders(),
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
        method: 'POST',
        headers: getAuthHeaders(),
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
        method: 'POST',
        headers: getAuthHeaders(),
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
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async manageCommunityPool(action: 'ACTIVATE_ALL_OBSERVATION' | 'PURGE_QUARANTINED' | 'RESET_ALL_DEBT'): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/pool/manage', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async syncUserSession(user: { id: string; email?: string; tier?: string; authProvider?: string }): Promise<{ token?: string } | null> {
    try {
      const res = await fetch('/api/auth/sync-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // offline / error fallback
    }
    return null;
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
  } | null> {
    try {
      const res = await fetch('/api/session', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // offline / error fallback
    }
    return null;
  },
};
