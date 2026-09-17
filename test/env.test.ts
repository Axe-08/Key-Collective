import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { TenantQuotaDO, Env } from "../src/index";
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
});
