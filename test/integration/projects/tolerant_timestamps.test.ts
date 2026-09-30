/**
 * Key Collective — Tolerant timestamp reads in projects routes (WP-1.2)
 *
 * Invariant Tested:
 * A project stored with epoch-second timestamps and one stored with
 * epoch-millisecond timestamps render the same dates from the projects API.
 */

import { describe, expect, it } from "vitest";
import { handleGetProjects } from "../../../src/worker/router/dashboard/project_routes";
import type { WorkerEnv } from "../../../src/worker/auth/types";

interface ProjectRow {
  id: string;
  name: string;
  tenant_id: string;
  description: string | null;
  created_at: string | number;
  updated_at: string | number;
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const firstRow = res.results[0] ?? null;
    if (!firstRow) return null;
    if (colName && typeof firstRow === "object") {
      return ((firstRow as Record<string, unknown>)[colName] ?? null) as T;
    }
    return firstRow;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    if (upper.includes("SELECT") && upper.includes("FROM PROJECTS")) {
      let filtered = [...this.db.projects];
      if (upper.includes("WHERE TENANT_ID = ?")) {
        const tenantId = String(this.boundParams[0]);
        filtered = filtered.filter((p) => p.tenant_id === tenantId);
      }
      return {
        results: filtered as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    return {
      results: [] as unknown as T[],
      success: true,
      meta: { duration: 1 } as D1Response["meta"],
    };
  }
}

class MockD1Database implements D1Database {
  public projects: ProjectRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

describe("Tolerant readers: GET /api/projects handles second and millisecond timestamp shapes identically", () => {
  it("returns identically-scaled (ms) timestamps for a second-scale row and a millisecond-scale row", async () => {
    const db = new MockD1Database();

    const secCreatedAt = 1_735_000_000; // seconds
    const secUpdatedAt = 1_735_003_600; // seconds
    db.projects.push({
      id: "proj-seconds",
      name: "Seconds Project",
      tenant_id: "tenant-x",
      description: null,
      created_at: secCreatedAt,
      updated_at: secUpdatedAt,
    });

    const msCreatedAt = secCreatedAt * 1000;
    const msUpdatedAt = secUpdatedAt * 1000;
    db.projects.push({
      id: "proj-millis",
      name: "Millis Project",
      tenant_id: "tenant-x",
      description: null,
      created_at: msCreatedAt,
      updated_at: msUpdatedAt,
    });

    const env = { DB: db } as unknown as WorkerEnv;
    const request = new Request("https://example.com/api/projects");
    const res = await handleGetProjects(request, env, "tenant-x");
    expect(res.status).toBe(200);

    const projects = (await res.json()) as Array<{
      id: string;
      created_at: number | null;
      updated_at: number | null;
    }>;
    expect(projects.length).toBe(2);

    const secondsRow = projects.find((p) => p.id === "proj-seconds");
    const millisRow = projects.find((p) => p.id === "proj-millis");
    expect(secondsRow).toBeDefined();
    expect(millisRow).toBeDefined();

    expect(secondsRow!.created_at).toBe(msCreatedAt);
    expect(millisRow!.created_at).toBe(msCreatedAt);
    expect(secondsRow!.created_at).toBe(millisRow!.created_at);

    expect(secondsRow!.updated_at).toBe(msUpdatedAt);
    expect(millisRow!.updated_at).toBe(msUpdatedAt);
    expect(secondsRow!.updated_at).toBe(millisRow!.updated_at);
  });
});
