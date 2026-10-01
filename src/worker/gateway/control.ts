import type { WorkerEnv } from "../auth/index";
import type { ControlMaintenanceState } from "../../pool/coordinator_do";

let cachedState: { state: ControlMaintenanceState; expiresAt: number } | null = null;

export function clearMaintenanceCache(): void {
  cachedState = null;
}

export async function checkMaintenance(
  env: WorkerEnv
): Promise<ControlMaintenanceState | null> {
  const now = Date.now();
  if (cachedState && cachedState.expiresAt > now) {
    return cachedState.state.maintenance ? cachedState.state : null;
  }

  const coordNs = env.POOL_COORDINATOR as DurableObjectNamespace | undefined;
  if (!coordNs) {
    return null;
  }

  try {
    const id = coordNs.idFromName("control");
    const stub = coordNs.get(id) as unknown as {
      getMaintenance?: () => Promise<ControlMaintenanceState>;
    };
    if (typeof stub.getMaintenance === "function") {
      const state = await stub.getMaintenance();
      cachedState = {
        state,
        expiresAt: now + 10_000,
      };
      return state.maintenance ? state : null;
    }
  } catch (err) {
    void err;
  }

  return null;
}
