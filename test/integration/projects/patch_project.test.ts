/**
 * Key Collective — PATCH /api/projects/:id persists its fields (WP-3.7, T-3.7.3)
 *
 * Invariants Tested:
 * 1. name, description, rpm_sub_cap and is_archived are stored (the handler used to echo them).
 * 2. rpm_sub_cap above the owner's tier RPM limit → 400 SUB_CAP_ABOVE_TIER.
 * 3. Another tenant's project → 404.
 * 4. Deleting a project unbinds its tokens instead of failing on the foreign key.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { getTierLimits } from "../../../src/quota/limits";
import { createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;

async function project(tenantId: string) {
  const id = `prj_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES (?, 'old', ?, 1, 1)").bind(id, tenantId).run();
  return id;
}

async function as(user: { id: string }) {
  const { cookie, csrfToken } = await createSession(user);
  return (path: string, method: string, body?: unknown) =>
    defaultMainWorker.fetch(
      new Request(`https://console.test${path}`, {
        method,
        headers: { cookie, "x-kc-csrf": csrfToken, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      workerEnv
    );
}

const stored = (id: string) =>
  env.DB.prepare("SELECT name, description, rpm_sub_cap, is_archived, updated_at FROM projects WHERE id = ?")
    .bind(id)
    .first<{ name: string; description: string | null; rpm_sub_cap: number | null; is_archived: number; updated_at: number }>();

describe("PATCH /api/projects/:id", () => {
  it("persists name, description, sub-cap and archive flag", async () => {
    const user = await createUser({ tier: "builder" });
    const id = await project(user.id);
    const before = Date.now();

    const res = await (await as(user))(`/api/projects/${id}`, "PATCH", { name: "new", description: "d", rpm_sub_cap: 2, is_archived: true });

    expect(res.status).toBe(200);
    const row = await stored(id);
    expect(row).toMatchObject({ name: "new", description: "d", rpm_sub_cap: 2, is_archived: 1 });
    expect(row!.updated_at).toBeGreaterThanOrEqual(before);
    expect(await res.json()).toMatchObject({ name: "new", rpm_sub_cap: 2, is_archived: true });
  });

  it("refuses a sub-cap above the tier RPM limit with 400 and can clear it", async () => {
    const user = await createUser({ tier: "builder" });
    const id = await project(user.id);
    const call = await as(user);
    const tierLimit = getTierLimits("builder").rpmLimit;

    const tooHigh = await call(`/api/projects/${id}`, "PATCH", { rpm_sub_cap: tierLimit + 1 });
    expect(tooHigh.status).toBe(400);
    expect(await tooHigh.json()).toMatchObject({ error: { code: "SUB_CAP_ABOVE_TIER" } });
    expect((await stored(id))?.rpm_sub_cap).toBeNull();

    await call(`/api/projects/${id}`, "PATCH", { rpm_sub_cap: tierLimit });
    expect((await stored(id))?.rpm_sub_cap).toBe(tierLimit);

    await call(`/api/projects/${id}`, "PATCH", { rpm_sub_cap: null });
    expect((await stored(id))?.rpm_sub_cap).toBeNull();
  });

  it("answers 404 for another tenant's project", async () => {
    const id = await project((await createUser()).id);

    const res = await (await as(await createUser()))(`/api/projects/${id}`, "PATCH", { name: "x" });

    expect(res.status).toBe(404);
    expect((await stored(id))?.name).toBe("old");
  });
});

describe("DELETE /api/projects/:id", () => {
  it("unbinds the project's tokens and deletes it", async () => {
    const user = await createUser();
    const id = await project(user.id);
    const call = await as(user);
    const token = (await (await call("/api/tokens", "POST", { project_id: id })).json()) as { id: string };

    const res = await call(`/api/projects/${id}`, "DELETE");

    expect(res.status).toBe(200);
    expect(await stored(id)).toBeNull();
    const row = await env.DB.prepare("SELECT project_id FROM auth_tokens WHERE id = ?").bind(token.id).first<{ project_id: string | null }>();
    expect(row?.project_id).toBeNull();
  });
});
