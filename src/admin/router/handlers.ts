import type { RouteHandler } from "./types";
import type { UserTier } from "../../contracts/v3_types";
import {
  getTenants,
  updateTenantTier,
  setTenantQuarantine,
  getPoolHealth,
  resetCircuitBreakers,
  isValidUserTier,
} from "./store";
import { Router, verifyAdmin } from "./http";

export const getTenantsHandler: RouteHandler = (_req, res) => {
  const tenants = getTenants();
  res.status(200).json({
    success: true,
    tenants,
    total: tenants.length,
  });
};

export const updateTenantRoleHandler: RouteHandler = (req, res) => {
  const tenantId = req.params?.id;
  if (!tenantId) {
    res.status(400).json({ error: "Missing tenant id parameter" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawTier = body.tier ?? body.newTier ?? body.role;

  if (typeof rawTier !== "string" || !isValidUserTier(rawTier)) {
    res.status(400).json({
      error: "Invalid or missing tier/role parameter",
      validTiers: ["admin", "ultra", "max", "builder", "probationary", "demo", "suspended"],
    });
    return;
  }

  const updated = updateTenantTier(tenantId, rawTier as UserTier);
  res.status(200).json({
    success: true,
    tenantId,
    tier: rawTier,
    updated: !!updated,
    reason: typeof body.reason === "string" ? body.reason : "Admin role mutation",
  });
};

export const quarantineTenantHandler: RouteHandler = (req, res) => {
  const tenantId = req.params?.id;
  if (!tenantId) {
    res.status(400).json({ error: "Missing tenant id parameter" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const isQuarantined =
    typeof body.isQuarantined === "boolean"
      ? body.isQuarantined
      : typeof body.quarantined === "boolean"
      ? body.quarantined
      : true;

  const reason = typeof body.reason === "string" ? body.reason : "Admin quarantine action";
  const updated = setTenantQuarantine(tenantId, isQuarantined);

  res.status(200).json({
    success: true,
    tenantId,
    isQuarantined,
    updated: !!updated,
    reason,
  });
};

export const getPoolHealthHandler: RouteHandler = (_req, res) => {
  const health = getPoolHealth();
  res.status(200).json(health);
};

export const resetCircuitBreakerHandler: RouteHandler = (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "all";

  const validProviders = ["gemini", "groq", "cerebras", "deepseek", "all"];
  if (!validProviders.includes(provider)) {
    res.status(400).json({
      error: `Invalid provider: '${provider}'. Valid options: ${validProviders.join(", ")}`,
    });
    return;
  }

  const resetResult = resetCircuitBreakers(provider);
  res.status(200).json({
    success: true,
    provider,
    reset: true,
    state: "NORMAL",
    circuitBreakers: resetResult,
    reason: typeof body.reason === "string" ? body.reason : "Admin circuit breaker reset",
  });
};

export function createAdminRouter() {
  const router = Router();

  // Apply strict zero-knowledge denial middleware
  router.use(verifyAdmin);

  // 1. GET /admin/api/tenants & GET /tenants
  router.get("/admin/api/tenants", getTenantsHandler);
  router.get("/tenants", getTenantsHandler);

  // 2. POST /admin/api/tenants/:id/role & POST /tenants/:id/role
  router.post("/admin/api/tenants/:id/role", updateTenantRoleHandler);
  router.post("/tenants/:id/role", updateTenantRoleHandler);

  // 3. POST /admin/api/tenants/:id/quarantine & POST /tenants/:id/quarantine
  router.post("/admin/api/tenants/:id/quarantine", quarantineTenantHandler);
  router.post("/tenants/:id/quarantine", quarantineTenantHandler);

  // 4. GET /admin/api/pool/health & GET /pool/health
  router.get("/admin/api/pool/health", getPoolHealthHandler);
  router.get("/pool/health", getPoolHealthHandler);

  // 5. POST /admin/api/pool/circuit-breaker/reset & POST /pool/circuit-breaker/reset
  router.post("/admin/api/pool/circuit-breaker/reset", resetCircuitBreakerHandler);
  router.post("/pool/circuit-breaker/reset", resetCircuitBreakerHandler);

  return router;
}

export const adminRouter = createAdminRouter();
