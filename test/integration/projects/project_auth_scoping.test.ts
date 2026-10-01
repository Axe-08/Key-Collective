/**
 * Key Collective — project scoping in the /v1 auth middleware (WP-3.7, T-3.7.4)
 *
 * Invariants Tested:
 * 1. A token bound to project P with sub-cap 2: the third request in a minute → 429
 *    project_sub_cap_exceeded, whether x-project-id is omitted or names another project.
 * 2. A token bound to an archived project → 403 project_archived.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createApiKey, createUser } from "../../helpers/world";

const workerEnv = env as unknown as WorkerEnv;

async function boundToken(opts: { subCap?: number; archived?: boolean }) {
  const user = await createUser({ tier: "builder" });
  const projectId = `prj_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO projects (id, name, tenant_id, rpm_sub_cap, is_archived) VALUES (?, 'p', ?, ?, ?)")
    .bind(projectId, user.id, opts.subCap ?? null, opts.archived ? 1 : 0)
    .run();
  const token = await createApiKey(user);
  await env.DB.prepare("UPDATE auth_tokens SET project_id = ? WHERE tenant_id = ?").bind(projectId, user.id).run();
  return token;
}

/** Authenticated /v1 call that stops at body parsing, so no provider is reached. */
function call(token: string, projectHeader?: string): Promise<Response> {
  return defaultMainWorker.fetch(
    new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(projectHeader ? { "x-project-id": projectHeader } : {}),
      },
      body: "{not json",
    }),
    workerEnv
  );
}

describe("project scoping comes from the token, not a header", () => {
  it("enforces the bound project's sub-cap with x-project-id omitted", async () => {
    const token = await boundToken({ subCap: 2 });

    const statuses = [(await call(token)).status, (await call(token)).status];
    const third = await call(token);

    expect(statuses).not.toContain(429);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { code: "project_sub_cap_exceeded" } });
  });

  it("ignores an x-project-id naming another project", async () => {
    const token = await boundToken({ subCap: 2 });

    await call(token, "prj_someone_else");
    await call(token, "prj_someone_else");
    const third = await call(token, "prj_someone_else");

    expect(third.status).toBe(429);
  });

  it("rejects a token bound to an archived project with 403 project_archived", async () => {
    const token = await boundToken({ archived: true });

    const res = await call(token);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "project_archived" } });
  });
});
