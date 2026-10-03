/**
 * Key Collective — project-scoped API keys and rotation (WP-3.7, T-3.7.2)
 *
 * Invariants Tested:
 * 1. POST /api/tokens binds the token to a project the caller owns; a foreign project → 404.
 * 2. POST /api/tokens/:id/rotate returns a new secret once, keeps id and project, and the old
 *    secret stops authenticating.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;

async function project(tenantId: string, id = `prj_${crypto.randomUUID().slice(0, 8)}`) {
  await env.DB.prepare("INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES (?, 'p', ?, ?, ?)")
    .bind(id, tenantId, Date.now(), Date.now())
    .run();
  return id;
}

async function as(user: { id: string }) {
  const { cookie, csrfToken } = await createSession(user);
  return (path: string, method = "GET", body?: unknown) =>
    defaultMainWorker.fetch(
      new Request(`https://console.test${path}`, {
        method,
        headers: { cookie, "x-kc-csrf": csrfToken, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      workerEnv
    );
}

/** An authenticated /v1 call that never reaches a provider: auth answers 401 before the body is read. */
const v1Authed = (token: string) =>
  defaultMainWorker.fetch(
    new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{not json",
    }),
    workerEnv
  );

describe("project-scoped tokens", () => {
  it("binds a new token to a project the caller owns", async () => {
    const user = await createUser();
    const prj = await project(user.id);
    const call = await as(user);

    const res = await call("/api/tokens", "POST", { project_id: prj });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; project_id: string };
    expect(body.project_id).toBe(prj);
    const row = await env.DB.prepare("SELECT project_id FROM auth_tokens WHERE id = ?").bind(body.id).first<{ project_id: string }>();
    expect(row?.project_id).toBe(prj);
    const list = (await (await call("/api/tokens")).json()) as Array<{ id: string; project_id: string | null }>;
    expect(list.find((t) => t.id === body.id)?.project_id).toBe(prj);
  });

  it("refuses another tenant's project with 404", async () => {
    const owner = await createUser();
    const prj = await project(owner.id);
    const call = await as(await createUser());

    const res = await call("/api/tokens", "POST", { project_id: prj });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "PROJECT_NOT_FOUND" } });
  });
});

describe("POST /api/tokens/:id/rotate", () => {
  it("returns a new secret once, keeps id and project, and retires the old secret", async () => {
    const user = await createUser();
    const prj = await project(user.id);
    const call = await as(user);
    const created = (await (await call("/api/tokens", "POST", { project_id: prj })).json()) as { id: string; token: string };

    const res = await call(`/api/tokens/${created.id}/rotate`, "POST");

    expect(res.status).toBe(200);
    const rotated = (await res.json()) as { id: string; token: string; project_id: string };
    expect(rotated.id).toBe(created.id);
    expect(rotated.project_id).toBe(prj);
    expect(rotated.token).not.toBe(created.token);
    expect((await v1Authed(created.token)).status).toBe(401);
    expect((await v1Authed(rotated.token)).status).not.toBe(401);
  });

  it("answers 404 for another tenant's token", async () => {
    const owner = await createUser();
    const created = (await (await (await as(owner))("/api/tokens", "POST", {})).json()) as { id: string };

    const res = await (await as(await createUser()))(`/api/tokens/${created.id}/rotate`, "POST");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/tokens lists project keys only (T-F.7.3, QA-13)", () => {
  it("omits Playground tokens and tokens with no project", async () => {
    const user = await createUser();
    const prj = await project(user.id);
    const call = await as(user);
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 15 * 60_000).toISOString();
    const insert = (id: string, projectId: string | null, expiresAt: string | null) =>
      env.DB.prepare(
        `INSERT INTO auth_tokens (id, hash_sha256, tenant_id, allowed_providers, rpm_limit, expires_at, created_at, project_id, budget_cu, spent_cu)
         VALUES (?, ?, ?, '[]', 10, ?, ?, ?, null, '0')`
      )
        .bind(id, crypto.randomUUID().replace(/-/g, ""), user.id, expiresAt, now, projectId)
        .run();
    await insert(`tok_play_${crypto.randomUUID().slice(0, 8)}`, prj, later);
    await insert(`tok_${crypto.randomUUID()}`, null, null);
    const created = (await (await call("/api/tokens", "POST", { project_id: prj })).json()) as { id: string };

    const list = (await (await call("/api/tokens")).json()) as Array<{ id: string; project_id: string | null }>;

    expect(list.map((t) => t.id)).toEqual([created.id]);
  });
});
