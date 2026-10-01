/**
 * Key Collective v3/v4 — Dashboard Projects API Routes
 *
 * Implements:
 * - GET /api/projects: List projects for authenticated tenant (or all if admin)
 * - POST /api/projects: Create a new project for tenant
 * - DELETE /api/projects/:id: Delete a project scoped to tenant
 *
 * Invariants (GEMINI.md Constitution):
 * - Per-Tenant Compute & Storage Isolation: Scoped by tenantId.
 * - Strict TypeScript (zero `any`).
 */

import { calculateProjectQuota } from "../../../quota/limits";
import type { UserTier } from "../../../contracts/v3_types";
import type { D1Database } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../auth/types";
import { toEpochMs } from "../../../utils/time";

export interface ProjectRecord {
  id: string;
  name: string;
  tenant_id: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

interface CreateProjectBody {
  id?: string;
  name?: string;
  description?: string;
  tenant_id?: string;
}

function getDatabase(env: WorkerEnv): D1Database | null {
  const db = (env.D1_DB ?? env.DB) as D1Database | undefined;
  if (db && typeof db.prepare === "function") {
    return db;
  }
  return null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function normalizeProjectRows(rows: ProjectRecord[]): ProjectRecord[] {
  return rows.map((row) => ({
    ...row,
    created_at: (row.created_at === null || row.created_at === undefined
      ? row.created_at
      : toEpochMs(row.created_at)) as number,
    updated_at: (row.updated_at === null || row.updated_at === undefined
      ? row.updated_at
      : toEpochMs(row.updated_at)) as number,
  }));
}

function errorResponse(message: string, code: string, statusCode: number): Response {
  return jsonResponse(
    {
      error: {
        message,
        code,
        statusCode,
      },
    },
    statusCode
  );
}

/**
 * GET /api/projects
 * Lists all projects for the calling tenant. If admin, returns all projects
 * or filters by target tenant specified via header or query param.
 */
export async function handleGetProjects(
  request: Request,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }

  const db = getDatabase(env);
  if (!db) {
    return jsonResponse([]);
  }

  const isAdmin = tenantId === "admin";
  let targetTenant: string | null = null;

  if (isAdmin) {
    try {
      const url = new URL(request.url);
      targetTenant =
        url.searchParams.get("tenant_id") ||
        url.searchParams.get("tenantId") ||
        null;
    } catch {
      targetTenant = null;
    }
  }

  try {
    if (isAdmin && !targetTenant) {
      const result = await db
        .prepare(
          `SELECT id, name, tenant_id, description, created_at, updated_at
           FROM projects
           ORDER BY created_at DESC`
        )
        .all<ProjectRecord>();
      return jsonResponse(normalizeProjectRows(result.results ?? []));
    }

    const scopedTenant = isAdmin && targetTenant ? targetTenant : tenantId;
    const result = await db
      .prepare(
        `SELECT id, name, tenant_id, description, created_at, updated_at
         FROM projects
         WHERE tenant_id = ?
         ORDER BY created_at DESC`
      )
      .bind(scopedTenant)
      .all<ProjectRecord>();

    return jsonResponse(normalizeProjectRows(result.results ?? []));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}

/**
 * POST /api/projects
 * Creates a new project record in D1 for the tenant.
 */
export async function handlePostProjects(
  request: Request,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }

  const db = getDatabase(env);
  if (!db) {
    return errorResponse("D1 Database binding missing", "DATABASE_ERROR", 500);
  }

  let body: CreateProjectBody;
  try {
    body = (await request.json()) as CreateProjectBody;
  } catch {
    return errorResponse("Invalid JSON body", "BAD_REQUEST", 400);
  }

  if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
    return errorResponse("Project name is required", "BAD_REQUEST", 400);
  }

  const name = body.name.trim();
  const description =
    typeof body.description === "string" && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  const isAdmin = tenantId === "admin";
  const targetTenantId =
    isAdmin && body.tenant_id && typeof body.tenant_id === "string" && body.tenant_id.trim().length > 0
      ? body.tenant_id.trim()
      : tenantId;

  const projectId =
    body.id && typeof body.id === "string" && body.id.trim().length > 0
      ? body.id.trim()
      : `proj_${Date.now().toString(36)}_${crypto.randomUUID().substring(0, 8)}`;

  const now = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO projects (id, name, tenant_id, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(projectId, name, targetTenantId, description, now, now)
      .run();

    const createdProject: ProjectRecord = {
      id: projectId,
      name,
      tenant_id: targetTenantId,
      description,
      created_at: now,
      updated_at: now,
    };

    return jsonResponse(createdProject, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY") || msg.includes("constraint")) {
      return errorResponse(`Project with ID '${projectId}' already exists`, "CONFLICT", 409);
    }
    return errorResponse(msg, "DATABASE_ERROR", 500);
  }
}

/**
 * DELETE /api/projects/:id
 * Deletes a project scoped to the authenticated tenant.
 */
export async function handleDeleteProject(
  pathname: string,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }

  const match = pathname.match(/^\/api\/projects\/([^/?#]+)/);
  const projectId = match ? decodeURIComponent(match[1].trim()) : "";

  if (!projectId) {
    return errorResponse("Project ID is required", "BAD_REQUEST", 400);
  }

  const db = getDatabase(env);
  if (!db) {
    return errorResponse("D1 Database binding missing", "DATABASE_ERROR", 500);
  }

  const isAdmin = tenantId === "admin";

  try {
    const existing = isAdmin
      ? await db
          .prepare("SELECT id, tenant_id FROM projects WHERE id = ?")
          .bind(projectId)
          .first<{ id: string; tenant_id: string }>()
      : await db
          .prepare("SELECT id, tenant_id FROM projects WHERE id = ? AND tenant_id = ?")
          .bind(projectId, tenantId)
          .first<{ id: string; tenant_id: string }>();

    if (!existing) {
      return errorResponse(`Project '${projectId}' not found`, "NOT_FOUND", 404);
    }

    // Tokens reference projects(id): unbind them first, or the delete fails on the foreign key.
    await db.prepare("UPDATE auth_tokens SET project_id = NULL WHERE project_id = ?").bind(projectId).run();

    if (isAdmin) {
      await db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run();
    } else {
      await db
        .prepare("DELETE FROM projects WHERE id = ? AND tenant_id = ?")
        .bind(projectId, tenantId)
        .run();
    }

    return jsonResponse({ success: true, id: projectId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}

interface UpdateProjectBody {
  name?: string;
  description?: string | null;
  is_archived?: boolean;
  rpm_sub_cap?: number | null;
}

/**
 * PATCH /api/projects/:id
 * Updates mutable fields of a project (name, description, is_archived, rpm_sub_cap).
 */
export async function handleUpdateProject(
  request: Request,
  pathname: string,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }

  const match = pathname.match(/^\/api\/projects\/([^/?#]+)/);
  const projectId = match ? decodeURIComponent(match[1].trim()) : "";

  if (!projectId) {
    return errorResponse("Project ID is required", "BAD_REQUEST", 400);
  }

  const db = getDatabase(env);
  if (!db) {
    return errorResponse("D1 Database binding missing", "DATABASE_ERROR", 500);
  }

  let body: UpdateProjectBody = {};
  try {
    body = (await request.json()) as UpdateProjectBody;
  } catch {
    return errorResponse("Invalid JSON body", "BAD_REQUEST", 400);
  }

  const isAdmin = tenantId === "admin";

  try {
    const existing = isAdmin
      ? await db
          .prepare("SELECT id, name, description, tenant_id FROM projects WHERE id = ?")
          .bind(projectId)
          .first<{ id: string; name: string; description: string | null; tenant_id: string }>()
      : await db
          .prepare("SELECT id, name, description, tenant_id FROM projects WHERE id = ? AND tenant_id = ?")
          .bind(projectId, tenantId)
          .first<{ id: string; name: string; description: string | null; tenant_id: string }>();

    if (!existing) {
      return errorResponse(`Project '${projectId}' not found`, "NOT_FOUND", 404);
    }

    const newName = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : existing.name;
    const newDesc = body.description !== undefined ? (typeof body.description === "string" ? body.description.trim() : null) : existing.description;

    // rpm_sub_cap: absent keeps the stored value, null clears it, a number must not exceed the
    // owner's tier RPM limit (400 SUB_CAP_ABOVE_TIER, shown inline by the Workbench).
    let subCapSql = "rpm_sub_cap";
    const subCapParams: unknown[] = [];
    if (body.rpm_sub_cap === null) {
      subCapSql = "NULL";
    } else if (body.rpm_sub_cap !== undefined) {
      if (typeof body.rpm_sub_cap !== "number" || !Number.isInteger(body.rpm_sub_cap) || body.rpm_sub_cap < 1) {
        return errorResponse("rpm_sub_cap must be a positive integer", "BAD_REQUEST", 400);
      }
      const owner = await db.prepare("SELECT tier FROM users WHERE id = ?").bind(existing.tenant_id).first<{ tier: string }>();
      const tierMax = calculateProjectQuota((owner?.tier ?? "builder") as UserTier);
      if (body.rpm_sub_cap > tierMax) {
        return errorResponse(`RPM sub-cap exceeds your tier maximum of ${tierMax}`, "SUB_CAP_ABOVE_TIER", 400);
      }
      subCapSql = "?";
      subCapParams.push(body.rpm_sub_cap);
    }
    const archiveSql = body.is_archived === undefined ? "is_archived" : "?";
    const archiveParams = body.is_archived === undefined ? [] : [body.is_archived ? 1 : 0];
    const now = Date.now();

    const row = await db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, rpm_sub_cap = ${subCapSql}, is_archived = ${archiveSql}, updated_at = ?
          WHERE id = ? RETURNING id, name, description, rpm_sub_cap, is_archived, updated_at`
      )
      .bind(newName, newDesc, ...subCapParams, ...archiveParams, now, projectId)
      .first<{ id: string; name: string; description: string | null; rpm_sub_cap: number | null; is_archived: number; updated_at: number }>();

    return jsonResponse({
      success: true,
      id: projectId,
      name: row?.name ?? newName,
      description: row?.description ?? newDesc,
      is_archived: row?.is_archived === 1,
      rpm_sub_cap: row?.rpm_sub_cap ?? null,
      updated_at: row?.updated_at ?? now,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}
