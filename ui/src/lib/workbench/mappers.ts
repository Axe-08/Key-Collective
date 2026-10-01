/**
 * Server rows → Workbench view models (WP-3.9). Nothing here invents numbers: values the
 * server does not report (live RPM, latency) stay undefined and render as "—".
 */
import type { ProjectRecord, TokenSummary } from '../../../../src/contracts/api/responses';
import type { ExtendedKey, ExtendedProject } from './types';
import { formatDate } from './formatters';

const iso = (v: number | string | undefined | null) =>
  v === undefined || v === null ? new Date(0).toISOString() : new Date(v).toISOString();

export function toProject(p: ProjectRecord, idx: number): ExtendedProject {
  return {
    id: p.id,
    tenantId: p.tenant_id ?? '',
    name: p.name,
    slug: p.id,
    description: p.description ?? undefined,
    maxRpmSubCap: p.rpm_sub_cap ?? null,
    isArchived: p.is_archived === true || p.is_archived === 1,
    createdAt: iso(p.created_at),
    updatedAt: iso(p.updated_at),
    assignedRpm: undefined,
    latency: '—',
    icon: idx % 2 === 0 ? 'hub' : 'psychology',
    iconColor: idx % 2 === 0 ? 'text-primary' : 'text-tertiary',
  };
}

/** Secrets are never kept: the list shows the masked hash; a new secret appears once in a modal. */
export function toKey(t: TokenSummary, tenantId: string): ExtendedKey {
  const created = t.created_at ?? new Date().toISOString();
  return {
    id: t.id,
    projectId: t.project_id ?? '',
    tenantId: t.tenant_id ?? tenantId,
    name: `API key …${t.id.slice(-6)}`,
    tokenPrefix: t.hash_masked ?? '',
    tokenHashSha256: t.hash_masked ?? '',
    isRevoked: false,
    lastUsedAt: null,
    createdAt: created,
    displayTime: '—',
    displayCreated: `Created ${formatDate(created)}`,
  };
}
