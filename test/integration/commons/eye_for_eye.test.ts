import { describe, expect, it, beforeEach, vi } from "vitest";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { LeaseOrchestrator } from "../../../src/router/leases/orchestrator";
import {
  getWouldDenyStats,
} from "../../../src/pool/enforcement";
import { EyeForEyeError } from "../../../src/errors";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

async function clearWouldDenyStats(): Promise<void> {
  await env.DB.prepare("DELETE FROM would_deny_hourly").run();
}

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("Eye-for-eye firewall (WP-5.7 T-5.7.1)", () => {
  beforeEach(async () => {
    await clearWouldDenyStats();
  });

  it("Gemini-only contributor cannot borrow Groq in enforce mode -> 429 eye_for_eye", async () => {
    const geminiContributor = await createUser({ github: true, eligible: true });
    const groqLender = await createUser({ github: true, eligible: true });

    const geminiKey = await addProviderKey(geminiContributor, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyEyeForEyeGeminiContributorKey01",
      rpmLimit: 500,
      rpdLimit: 1000,
    });
    const groqKey = await addProviderKey(groqLender, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_EyeForEyeGroqLenderKey00000000001",
      rpmLimit: 500,
      rpdLimit: 1000,
    });

    // Register geminiContributor's ACTIVE key in pool:google
    const googleStub = getCoordinatorStub("pool:google");
    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });
      await coord.upsertKey({
        keyId: geminiKey.id,
        owner: geminiContributor.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });
    });

    // Register groqLender's ACTIVE key in pool:groq (geminiContributor has NO active key in pool:groq)
    const groqStub = getCoordinatorStub("pool:groq");
    await runInDurableObject(groqStub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });
      await coord.upsertKey({
        keyId: groqKey.id,
        owner: groqLender.id,
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });

      const accessible = await coord.isEyeForEyeAccessible(geminiContributor.id, "groq");
      expect(accessible).toBe(false);

      const lease = await coord.lease({
        tenant: geminiContributor.id,
        ownOnly: false,
        provider: "groq",
      });
      expect(lease).toBeNull();
      expect(await coord.getLastRefusalReason(geminiContributor.id)).toBe("eye_for_eye");
    });

    // Orchestrator throws EyeForEyeError (429 eye_for_eye) naming the provider that needs a contribution
    const orchestrator = new LeaseOrchestrator();
    await expect(
      orchestrator.acquire("groq", {
        tenantId: geminiContributor.id,
        env: { ...env, COMMONS_ENFORCEMENT: "enforce" },
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "eye_for_eye",
      provider: "groq",
    });

    // Verify EyeForEyeError instance
    const err = new EyeForEyeError("groq");
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("eye_for_eye");
    expect(err.message.toLowerCase()).toContain("groq");

    // Verify /api/pool/telemetry eye_for_eye_accessible reflects pool:google=true, pool:groq=false
    const { handlePoolRoute } = await import("../../../src/worker/pool_routes");
    const telReq = new Request("https://console.test/api/pool/telemetry");
    const telRes = await handlePoolRoute(
      "/api/pool/telemetry",
      "GET",
      telReq,
      env as unknown as Parameters<typeof handlePoolRoute>[3],
      geminiContributor.id,
      { waitUntil: () => {} }
    );
    expect(telRes).not.toBeNull();
    expect(telRes!.status).toBe(200);
    const telBody = (await telRes!.json()) as {
      provider_pools: Array<{ provider: string; eye_for_eye_accessible: boolean }>;
    };
    const geminiPool = telBody.provider_pools.find((p) => p.provider === "gemini");
    const groqPool = telBody.provider_pools.find((p) => p.provider === "groq");
    expect(geminiPool?.eye_for_eye_accessible).toBe(true);
    expect(groqPool?.eye_for_eye_accessible).toBe(false);
  });

  it("in observe mode serves the Gemini-only contributor from Groq and records one would_deny for eye_for_eye", async () => {
    const geminiContributor = await createUser({ github: true, eligible: true });
    const groqLender = await createUser({ github: true, eligible: true });

    const groqKey = await addProviderKey(groqLender, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_EyeForEyeGroqObserveKey0000000002",
      rpmLimit: 500,
      rpdLimit: 1000,
    });

    const groqStub = getCoordinatorStub("pool:groq");
    await runInDurableObject(groqStub, async (coord: PoolCoordinatorDO) => {
      await clearWouldDenyStats();
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "observe" });
      await coord.upsertKey({
        keyId: groqKey.id,
        owner: groqLender.id,
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });

      const orchestrator = new LeaseOrchestrator();
      const lease = await orchestrator.acquire("groq", {
        tenantId: geminiContributor.id,
        env: { ...env, COMMONS_ENFORCEMENT: "observe" },
      });

      expect(lease).not.toBeNull();
      expect(lease?.source).toBe("borrowed");
      expect(lease?.keyId).toBe(groqKey.id);

      await vi.waitFor(async () => {
        const stats = await getWouldDenyStats(env.DB, 24);
        expect(stats.rules.eye_for_eye).toBe(1);
        expect(stats.total).toBe(1);
      });
    });
  });
});
