import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { TenantQuotaDO, PoolCoordinatorDO, Env } from "../src/index";
import type { WorkerEnv } from "../src/worker/auth/types";

describe("Environment & Durable Object Bindings (task-1-bind-tenant-quota)", () => {
  it("should export TenantQuotaDO from src/index.ts", () => {
    expect(TenantQuotaDO).toBeDefined();
    expect(typeof TenantQuotaDO).toBe("function");
  });

  it("should typecheck Env and WorkerEnv with TENANT_QUOTA", () => {
    const mockNamespace = {} as DurableObjectNamespace;
    const env: Partial<Env> = {
      TENANT_QUOTA: mockNamespace,
    };
    expect(env.TENANT_QUOTA).toBe(mockNamespace);

    const workerEnv: Partial<WorkerEnv> = {
      TENANT_QUOTA: mockNamespace,
    };
    expect(workerEnv.TENANT_QUOTA).toBe(mockNamespace);
  });

  it("should bind TENANT_QUOTA in wrangler.jsonc (root, dev, production, migration tag v5)", () => {
    const wranglerPath = path.resolve(__dirname, "../wrangler.jsonc");
    const rawContent = fs.readFileSync(wranglerPath, "utf-8");
    const cleaned = rawContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
    const config = JSON.parse(cleaned);

    // Root bindings
    const rootBindings = config.durable_objects?.bindings ?? [];
    const rootQuotaBinding = rootBindings.find(
      (b: any) => b.name === "TENANT_QUOTA" && b.class_name === "TenantQuotaDO"
    );
    expect(rootQuotaBinding).toBeDefined();

    // Migrations tag v5
    const migrations = config.migrations ?? [];
    const v5Migration = migrations.find((m: any) => m.tag === "v5");
    expect(v5Migration).toBeDefined();
    expect(v5Migration.new_sqlite_classes).toContain("TenantQuotaDO");

    // Dev environment bindings
    const devBindings = config.env?.dev?.durable_objects?.bindings ?? [];
    const devQuotaBinding = devBindings.find(
      (b: any) => b.name === "TENANT_QUOTA" && b.class_name === "TenantQuotaDO"
    );
    expect(devQuotaBinding).toBeDefined();

    // Production environment bindings
    const prodBindings = config.env?.production?.durable_objects?.bindings ?? [];
    const prodQuotaBinding = prodBindings.find(
      (b: any) => b.name === "TENANT_QUOTA" && b.class_name === "TenantQuotaDO"
    );
    expect(prodQuotaBinding).toBeDefined();
  });

  it("should export PoolCoordinatorDO from src/index.ts and typecheck Env", () => {
    expect(PoolCoordinatorDO).toBeDefined();
    expect(typeof PoolCoordinatorDO).toBe("function");

    const mockNamespace = {} as DurableObjectNamespace;
    const env: Partial<Env> = {
      POOL_COORDINATOR: mockNamespace,
    };
    expect(env.POOL_COORDINATOR).toBe(mockNamespace);
  });

  it("should bind POOL_COORDINATOR across root, dev, and production in wrangler.jsonc (N-07)", () => {
    const wranglerPath = path.resolve(__dirname, "../wrangler.jsonc");
    const rawContent = fs.readFileSync(wranglerPath, "utf-8");
    const cleaned = rawContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
    const config = JSON.parse(cleaned);

    // Root bindings
    const rootBindings = config.durable_objects?.bindings ?? [];
    const rootCoordBinding = rootBindings.find(
      (b: any) => b.name === "POOL_COORDINATOR" && b.class_name === "PoolCoordinatorDO"
    );
    expect(rootCoordBinding).toBeDefined();

    // Dev environment bindings
    const devBindings = config.env?.dev?.durable_objects?.bindings ?? [];
    const devCoordBinding = devBindings.find(
      (b: any) => b.name === "POOL_COORDINATOR" && b.class_name === "PoolCoordinatorDO"
    );
    expect(devCoordBinding).toBeDefined();

    // Production environment bindings
    const prodBindings = config.env?.production?.durable_objects?.bindings ?? [];
    const prodCoordBinding = prodBindings.find(
      (b: any) => b.name === "POOL_COORDINATOR" && b.class_name === "PoolCoordinatorDO"
    );
    expect(prodCoordBinding).toBeDefined();
  });

  it("should define host vars and custom domain routes in wrangler.jsonc (WP-2.7)", () => {
    const wranglerPath = path.resolve(__dirname, "../wrangler.jsonc");
    const rawContent = fs.readFileSync(wranglerPath, "utf-8");
    const cleaned = rawContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
    const config = JSON.parse(cleaned);

    // Root vars
    expect(config.vars?.API_HOST).toBe("api.key-col.axe08.tech");
    expect(config.vars?.CONSOLE_HOST).toBe("console.key-col.axe08.tech");
    expect(config.vars?.ADMIN_HOST).toBe("admin.key-col.axe08.tech");
    expect(config.vars?.APEX_HOST).toBe("key-col.axe08.tech");
    expect(config.vars?.LEGACY_SUNSET).toBeUndefined();

    // Dev vars
    const devVars = config.env?.dev?.vars;
    expect(devVars?.API_HOST).toBe("api-dev.key-col.axe08.tech");
    expect(devVars?.CONSOLE_HOST).toBe("console-dev.key-col.axe08.tech");
    expect(devVars?.ADMIN_HOST).toBe("admin-dev.key-col.axe08.tech");
    expect(devVars?.APEX_HOST).toBe("dev.key-col.axe08.tech");
    expect(devVars?.LEGACY_SUNSET).toBeUndefined();

    // Dev routes
    const devRoutes = config.env?.dev?.routes ?? [];
    const devPatterns = devRoutes.map((r: any) => r.pattern);
    expect(devPatterns).toContain("dev.key-col.axe08.tech");
    expect(devPatterns).toContain("api-dev.key-col.axe08.tech");
    expect(devPatterns).toContain("console-dev.key-col.axe08.tech");
    expect(devPatterns).toContain("admin-dev.key-col.axe08.tech");
    for (const route of devRoutes) {
      expect(route.custom_domain).toBe(true);
    }

    // Production vars
    const prodVars = config.env?.production?.vars;
    expect(prodVars?.API_HOST).toBe("api.key-col.axe08.tech");
    expect(prodVars?.CONSOLE_HOST).toBe("console.key-col.axe08.tech");
    expect(prodVars?.ADMIN_HOST).toBe("admin.key-col.axe08.tech");
    expect(prodVars?.APEX_HOST).toBe("key-col.axe08.tech");
    expect(prodVars?.LEGACY_SUNSET).toBeUndefined();
  });
});

