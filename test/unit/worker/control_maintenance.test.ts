/**
 * WP-F.10 T-F.10.8 (AU-02): an unreachable control coordinator fails open
 * (the API keeps serving) and the failure is logged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMaintenance, clearMaintenanceCache } from "../../../src/worker/gateway/control";
import type { WorkerEnv } from "../../../src/worker/auth/index";

afterEach(() => {
  vi.restoreAllMocks();
  clearMaintenanceCache();
});

describe("checkMaintenance degraded path (AU-02)", () => {
  it("returns null and logs maintenance_check_failed when the control DO throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      POOL_COORDINATOR: {
        idFromName: (name: string) => name,
        get: () => ({
          getMaintenance: async (): Promise<never> => {
            throw new Error("control shard unreachable");
          },
        }),
      },
    } as unknown as WorkerEnv;

    await expect(checkMaintenance(env)).resolves.toBeNull();
    const lines = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some((l) => l.includes("maintenance_check_failed") && l.includes("control shard unreachable"))
    ).toBe(true);
  });
});
