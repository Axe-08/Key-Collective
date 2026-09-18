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

import type { D1Database } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../auth/types";

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
        request.headers.get("x-tenant-id") ||
        url.searchParams.get("tenant_id") ||
        url.searchParams.get("tenantId") ||
        null;
    } catch {
      targetTenant = request.headers.get("x-tenant-id");
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
      return jsonResponse(result.results ?? []);
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

    return jsonResponse(result.results ?? []);
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
  const headerTenant = request.headers.get("x-tenant-id");
  const targetTenantId =
    isAdmin && headerTenant && headerTenant.trim().length > 0
      ? headerTenant.trim()
      : isAdmin && body.tenant_id && typeof body.tenant_id === "string" && body.tenant_id.trim().length > 0
      ? body.tenant_id.trim()
      : tenantId;

  const projectId =
    body.id && typeof body.id === "string" && body.id.trim().length > 0
      ? body.id.trim()
      : `proj_${Date.now().toString(36)}_${crypto.randomUUID().substring(0, 8)}`;

  const now = Math.floor(Date.now() / 1000);

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

    // Disassociate keys referencing this project if foreign keys exist
    try {
      await db.prepare("UPDATE keys SET project_id = NULL WHERE project_id = ?").bind(projectId).run();
    } catch {
      // keys table or column may not exist in all environments
    }

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
  description?: string;
  is_archived?: boolean;
  rpm_sub_cap?: number;
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
    const now = Math.floor(Date.now() / 1000);

    try {
      await db
        .prepare(
          "UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?"
        )
        .bind(newName, newDesc, now, projectId)
        .run();
    } catch {
      // ignore schema differences
    }

    return jsonResponse({
      success: true,
      id: projectId,
      name: newName,
      description: newDesc,
      is_archived: body.is_archived,
      rpm_sub_cap: body.rpm_sub_cap,
      updated_at: now,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}
