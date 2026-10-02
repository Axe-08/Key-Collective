/**
 * Key Collective v3/v4 — Dashboard Auth Tokens API Routes
 *
 * Implements:
 * - GET /api/tokens: List active tokens for authenticated tenant (or all if admin), with masked hashes
 * - POST /api/tokens: Create a new CSPRNG token (kc_proj_live_<hex>), hash via Web Crypto, AES-256-GCM encrypt, and insert into D1
 * - DELETE /api/tokens/:id: Delete token scoped to tenant
 *
 * Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys: AES-256-GCM encryption via Web Crypto API with unique 12-byte nonces stored in D1.
 * - Per-Tenant Compute & Storage Isolation: Scoped by tenantId. Zero cross-tenant state.
 * - Fixed-Point Microdollars: All costs/budgets in microdollars.
 * - Strict TypeScript (zero `any`).
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../auth/types";


export interface TokenSummary {
  id: string;
  tenant_id: string;
  rpm_limit: number;
  budget_microdollars?: number;
  spent_microdollars?: number;
  budget_cu?: string | null;
  spent_cu?: string;
  created_at: string;
  expires_at: string | null;
  hash_sha256: string;
  hash_masked: string;
  project_id: string | null;
}

export interface CreateTokenBody {
  id?: string;
  rpm_limit?: number;
  budget_cu?: bigint | number | string | null;
  budget_microdollars?: number | bigint;
  allowed_providers?: string[];
  expires_at?: string | null;
  tenant_id?: string;
  /** Project the token is scoped to; must belong to the caller (WP-3.7). */
  project_id?: string;
}

interface RawTokenRow {
  id: string;
  hash_sha256: string;
  tenant_id: string;
  budget_cu?: string | null;
  spent_cu?: string | null;
  budget_microdollars?: number;
  spent_microdollars?: number;
  allowed_providers: string;
  rpm_limit: number;
  expires_at: string | null;
  created_at: string;
  project_id: string | null;
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
 * Masks a 64-character SHA-256 hash for secure display.
 */
export function maskHash(hash: string | null | undefined): string {
  if (!hash || typeof hash !== "string") {
    return "****************";
  }
  const clean = hash.trim();
  if (clean.length <= 16) {
    return "****************";
  }
  return `${clean.substring(0, 8)}...${clean.substring(clean.length - 8)}`;
}

/**
 * Generates a cryptographically secure token starting with kc_proj_live_<hex>.
 */
function generateCsprngToken(): string {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `kc_proj_live_${hex}`;
}

/**
 * Computes the SHA-256 hex string using the Web Crypto API.
 */
async function computeSha256(text: string): Promise<string> {
  const digestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encrypts a plaintext token using AES-256-GCM via Web Crypto API.
 */
async function encryptToken(
  plaintext: string,
  secretKey: string
): Promise<{ ciphertextB64: string; nonceB64: string }> {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const keyDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secretKey));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyDigest,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const encoded = new TextEncoder().encode(plaintext);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    encoded
  );
  const bytes = new Uint8Array(encryptedBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const ciphertextB64 = btoa(binary);

  let nonceBinary = "";
  for (let i = 0; i < nonce.length; i++) {
    nonceBinary += String.fromCharCode(nonce[i]);
  }
  const nonceB64 = btoa(nonceBinary);

  return { ciphertextB64, nonceB64 };
}

/**
 * GET /api/tokens
 * Lists active tokens for the calling tenant (or all if admin).
 * Token hashes are masked for security.
 */
export async function handleGetTokens(
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
  let includeExpired = false;

  try {
    const url = new URL(request.url);
    if (isAdmin) {
      targetTenant =
        url.searchParams.get("tenant_id") ||
        url.searchParams.get("tenantId") ||
        null;
    }
    includeExpired =
      url.searchParams.get("include_expired") === "true" ||
      url.searchParams.get("all") === "true";
  } catch {
    if (isAdmin) {
      targetTenant = null;
    }
  }

  try {
    let rows: RawTokenRow[] = [];

    if (isAdmin && !targetTenant) {
      const result = await db
        .prepare(
          `SELECT id, hash_sha256, tenant_id, allowed_providers, rpm_limit, expires_at, created_at, project_id, budget_cu, spent_cu
           FROM auth_tokens
           ORDER BY created_at DESC`
        )
        .all<RawTokenRow>();
      rows = result.results ?? [];
    } else {
      const scopedTenant = isAdmin && targetTenant ? targetTenant : tenantId;
      const result = await db
        .prepare(
          `SELECT id, hash_sha256, tenant_id, allowed_providers, rpm_limit, expires_at, created_at, project_id, budget_cu, spent_cu
           FROM auth_tokens
           WHERE tenant_id = ?
           ORDER BY created_at DESC`
        )
        .bind(scopedTenant)
        .all<RawTokenRow>();
      rows = result.results ?? [];
    }

    // Filter for active tokens unless caller explicitly requested expired tokens
    const now = Date.now();
    const activeRows = rows.filter((row) => {
      if (includeExpired) return true;
      if (!row.expires_at) return true;
      const expMs = new Date(row.expires_at).getTime();
      return isNaN(expMs) || expMs > now;
    });

    const formattedTokens: TokenSummary[] = activeRows.map((row) => {
      const masked = maskHash(row.hash_sha256);
      const budgetCu = row.budget_cu !== undefined && row.budget_cu !== null ? BigInt(row.budget_cu) : null;
      const spentCu = row.spent_cu !== undefined && row.spent_cu !== null ? BigInt(row.spent_cu) : 0n;
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        rpm_limit: Number(row.rpm_limit),
        budget_microdollars: budgetCu !== null ? Number(budgetCu) : Number(row.budget_microdollars ?? 0),
        spent_microdollars: Number(spentCu !== 0n ? spentCu : (row.spent_microdollars ?? 0)),
        budget_cu: budgetCu !== null ? budgetCu.toString() : null,
        spent_cu: spentCu.toString(),
        created_at: row.created_at,
        expires_at: row.expires_at ?? null,
        hash_sha256: masked,
        hash_masked: masked,
        project_id: row.project_id ?? null,
      };
    });

    return jsonResponse(formattedTokens);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}

/**
 * POST /api/tokens
 * Generates a new CSPRNG token starting with kc_proj_live_<hex>,
 * computes SHA-256 hash via Web Crypto API, AES-256-GCM encrypts for D1 storage,
 * and inserts the record. Returns the full plaintext token exactly once.
 */
export async function handlePostTokens(
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

  let body: CreateTokenBody = {};
  const contentType = request.headers.get("content-type") || "";

  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      body = JSON.parse(text) as CreateTokenBody;
    }
  } catch {
    if (contentType.includes("application/json")) {
      return errorResponse("Invalid JSON body", "BAD_REQUEST", 400);
    }
  }

  const isAdmin = tenantId === "admin";
  const targetTenantId =
    isAdmin && body.tenant_id && typeof body.tenant_id === "string" && body.tenant_id.trim().length > 0
      ? body.tenant_id.trim()
      : tenantId;

  // 0. Optional project scope: the project must belong to the token's tenant.
  const projectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
  if (projectId) {
    const owned = await db
      .prepare("SELECT id FROM projects WHERE id = ? AND tenant_id = ?")
      .bind(projectId, targetTenantId)
      .first<{ id: string }>();
    if (!owned) {
      return errorResponse("Project not found", "PROJECT_NOT_FOUND", 404);
    }
  }

  // 1. Generate CSPRNG token: kc_proj_live_<hex>
  const plaintextToken = generateCsprngToken();

  // 2. Compute SHA-256 hash via Web Crypto API
  const tokenHash = await computeSha256(plaintextToken);

  // 3. Encrypt via AES-256-GCM with unique 12-byte nonce (GEMINI.md Invariant)
  const masterKey = env.KC_MASTER_KEY as string | undefined;
  if (!masterKey || masterKey.trim().length === 0) {
    return Response.json(
      { error: "Server misconfiguration: KC_MASTER_KEY not set" },
      { status: 503 }
    );
  }

  let encryptedTokenB64: string | null = null;
  let nonceB64: string | null = null;

  try {
    const encrypted = await encryptToken(plaintextToken, masterKey);
    encryptedTokenB64 = encrypted.ciphertextB64;
    nonceB64 = encrypted.nonceB64;
  } catch (err: unknown) {
    console.warn("Failed to encrypt token with masterKey:", err);
  }

  // 4. Token parameters
  const tokenId =
    body.id && typeof body.id === "string" && body.id.trim().length > 0
      ? body.id.trim()
      : `tok_${Date.now().toString(36)}_${crypto.randomUUID().substring(0, 8)}`;

  const rpmLimit =
    typeof body.rpm_limit === "number" && body.rpm_limit > 0
      ? Math.floor(body.rpm_limit)
      : 60;

  let budgetCu: bigint | null = null;
  if (body.budget_cu !== undefined) {
    budgetCu = body.budget_cu === null ? null : BigInt(body.budget_cu);
  } else if (body.budget_microdollars !== undefined) {
    const b = BigInt(body.budget_microdollars);
    budgetCu = b === 0n ? null : b;
  }

  const budgetMicro = budgetCu !== null ? Number(budgetCu) : 0;

  const allowedProviders = Array.isArray(body.allowed_providers)
    ? JSON.stringify(body.allowed_providers)
    : "[]";

  let expiresAtIso: string | null = null;
  if (body.expires_at) {
    const parsed = new Date(body.expires_at);
    if (!isNaN(parsed.getTime())) {
      expiresAtIso = parsed.toISOString();
    }
  }

  const createdAtIso = new Date().toISOString();

  // 5. Insert into auth_tokens table
  try {
    await db
      .prepare(
        `INSERT INTO auth_tokens (
          id,
          hash_sha256,
          tenant_id,
          encrypted_token_b64,
          nonce_b64,
          allowed_providers,
          rpm_limit,
          expires_at,
          created_at,
          project_id,
          budget_cu,
          spent_cu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0')`
      )
      .bind(
        tokenId,
        tokenHash,
        targetTenantId,
        encryptedTokenB64,
        nonceB64,
        allowedProviders,
        rpmLimit,
        expiresAtIso,
        createdAtIso,
        projectId,
        budgetCu !== null ? budgetCu.toString() : null
      )
      .run();

    // 6. Return plaintext token exactly once along with metadata
    return jsonResponse(
      {
        id: tokenId,
        token: plaintextToken,
        tenant_id: targetTenantId,
        rpm_limit: rpmLimit,
        budget_microdollars: budgetMicro,
        spent_microdollars: 0,
        budget_cu: budgetCu !== null ? budgetCu.toString() : null,
        spent_cu: "0",
        allowed_providers: Array.isArray(body.allowed_providers) ? body.allowed_providers : [],
        expires_at: expiresAtIso,
        created_at: createdAtIso,
        project_id: projectId,
        hash_masked: maskHash(tokenHash),
      },
      201
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY") || msg.includes("constraint")) {
      return errorResponse(`Token with ID '${tokenId}' already exists`, "CONFLICT", 409);
    }
    return errorResponse(msg, "DATABASE_ERROR", 500);
  }
}

/**
 * DELETE /api/tokens/:id
 * Deletes or revokes a token from auth_tokens for the specified tenant_id and token id.
 */
export async function handleDeleteToken(
  pathname: string,
  env: WorkerEnv,
  tenantId: string
): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }

  const match = pathname.match(/^\/api\/tokens\/([^/?#]+)/);
  const tokenId = match ? decodeURIComponent(match[1].trim()) : "";

  if (!tokenId) {
    return errorResponse("Token ID is required", "BAD_REQUEST", 400);
  }

  const db = getDatabase(env);
  if (!db) {
    return errorResponse("D1 Database binding missing", "DATABASE_ERROR", 500);
  }

  const isAdmin = tenantId === "admin";

  try {
    const existing = isAdmin
      ? await db
          .prepare("SELECT id, tenant_id FROM auth_tokens WHERE id = ?")
          .bind(tokenId)
          .first<{ id: string; tenant_id: string }>()
      : await db
          .prepare("SELECT id, tenant_id FROM auth_tokens WHERE id = ? AND tenant_id = ?")
          .bind(tokenId, tenantId)
          .first<{ id: string; tenant_id: string }>();

    if (!existing) {
      return errorResponse(`Token '${tokenId}' not found`, "NOT_FOUND", 404);
    }

    if (isAdmin) {
      await db.prepare("DELETE FROM auth_tokens WHERE id = ?").bind(tokenId).run();
    } else {
      await db
        .prepare("DELETE FROM auth_tokens WHERE id = ? AND tenant_id = ?")
        .bind(tokenId, tenantId)
        .run();
    }

    return jsonResponse({ success: true, id: tokenId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database error";
    return errorResponse(message, "DATABASE_ERROR", 500);
  }
}

/**
 * POST /api/tokens/:id/rotate (WP-3.7): a new secret for the same token id and project. The
 * old hash is replaced, so the old secret stops authenticating; the new one is shown once.
 */
export async function handleRotateToken(pathname: string, env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }
  const db = getDatabase(env);
  if (!db) {
    return errorResponse("D1 Database binding missing", "DATABASE_ERROR", 500);
  }
  const masterKey = env.KC_MASTER_KEY as string | undefined;
  if (!masterKey || masterKey.trim().length === 0) {
    return Response.json({ error: "Server misconfiguration: KC_MASTER_KEY not set" }, { status: 503 });
  }
  const tokenId = decodeURIComponent(pathname.replace(/^\/api\/tokens\//, "").replace(/\/rotate\/?$/, ""));

  const plaintextToken = generateCsprngToken();
  const tokenHash = await computeSha256(plaintextToken);
  const { ciphertextB64, nonceB64 } = await encryptToken(plaintextToken, masterKey);
  const sql =
    "UPDATE auth_tokens SET hash_sha256 = ?, encrypted_token_b64 = ?, nonce_b64 = ? WHERE id = ?" +
    (tenantId === "admin" ? "" : " AND tenant_id = ?") +
    " RETURNING id, tenant_id, project_id";
  const params = [tokenHash, ciphertextB64, nonceB64, tokenId, ...(tenantId === "admin" ? [] : [tenantId])];
  const row = await db.prepare(sql).bind(...params).first<{ id: string; tenant_id: string; project_id: string | null }>();
  if (!row) {
    return errorResponse("Token not found", "NOT_FOUND", 404);
  }
  return jsonResponse({
    id: row.id,
    token: plaintextToken,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    hash_masked: maskHash(tokenHash),
  });
}

const PLAYGROUND_TTL_MS = 15 * 60 * 1000;
const PLAYGROUND_RPM = 10;

/**
 * POST /api/playground/token (WP-3.10, section 2.3 flow 6): a kc_live_ key for the signed-in
 * user, 10 RPM, valid for 15 minutes, so the Playground calls /v1 like any client would.
 */
export async function handlePlaygroundToken(env: WorkerEnv, tenantId: string): Promise<Response> {
  if (!tenantId || tenantId === "anonymous" || tenantId === "guest") {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }
  const db = getDatabase(env);
  const masterKey = env.KC_MASTER_KEY as string | undefined;
  if (!db || !masterKey) {
    return errorResponse("Playground tokens are not configured", "UNAVAILABLE", 503);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = `kc_live_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const { ciphertextB64, nonceB64 } = await encryptToken(token, masterKey);
  const id = `tok_play_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PLAYGROUND_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, encrypted_token_b64, nonce_b64,
         allowed_providers, rpm_limit, expires_at, created_at, budget_cu, spent_cu)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, null, '0')`
    )
    .bind(id, await computeSha256(token), tenantId, ciphertextB64, nonceB64, PLAYGROUND_RPM, expiresAt, createdAt)
    .run();
  return jsonResponse({ id, token, rpm_limit: PLAYGROUND_RPM, expires_at: expiresAt }, 201);
}
