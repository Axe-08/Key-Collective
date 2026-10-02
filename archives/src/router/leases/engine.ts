/**
 * Key Collective — Routing Engine Switch (D-23, WP-4.1)
 *
 * Selects between the legacy KeyPoolDO path ("legacy") and the PoolCoordinatorDO
 * lease path ("leases"). Defaults to "legacy" when unset or unrecognised so a
 * missing config variable is always a safe rollback.
 */

export type RoutingEngine = "legacy" | "leases";

export function routingEngine(env?: { ROUTING_ENGINE?: unknown } | null): RoutingEngine {
  const raw = env?.ROUTING_ENGINE;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "leases") {
    return "leases";
  }
  return "legacy";
}
