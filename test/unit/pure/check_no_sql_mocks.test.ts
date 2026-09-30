import { describe, expect, it } from "vitest";
import { checkContent } from "../../../scripts/check-no-sql-mocks.mjs";

describe("check-no-sql-mocks lint script", () => {
  describe("object literals with prepare cast or typed as D1Database", () => {
    it("detects object literal with prepare cast to D1Database (as D1Database)", () => {
      const code = `
        const mockDb = {
          prepare: vi.fn(),
        } as D1Database;
      `;
      expect(checkContent(code, "test/worker/router.test.ts")).toBe(false);
    });

    it("detects object literal with prepare cast via unknown (as unknown as D1Database)", () => {
      const code = `
        const mockDb = {
          prepare: (query: string) => ({
            bind: () => ({}),
          }),
        } as unknown as D1Database;
      `;
      expect(checkContent(code, "test/worker/router.test.ts")).toBe(false);
    });

    it("detects object literal typed as D1Database with prepare property", () => {
      const code = `
        const db: D1Database = {
          prepare: (query: string): D1PreparedStatement => {
            return stmt as unknown as D1PreparedStatement;
          },
          dump: vi.fn(),
          batch: vi.fn(),
          exec: vi.fn(),
        };
      `;
      expect(checkContent(code, "test/abuse_routes.test.ts")).toBe(false);
    });

    it("detects inline prepare with cast to D1Database", () => {
      const code = `
        const client = new Client({ prepare: vi.fn() } as unknown as D1Database);
      `;
      expect(checkContent(code, "test/client.test.ts")).toBe(false);
    });
  });

  describe("path exclusion for pure unit tests", () => {
    it("allows object literals with prepare in test/unit/pure/** paths", () => {
      const code = `
        const mockDb = {
          prepare: vi.fn(),
        } as D1Database;
      `;
      expect(checkContent(code, "test/unit/pure/something.test.ts")).toBe(true);
      expect(checkContent(code, "/app/test/unit/pure/my_parser.test.ts")).toBe(true);
      expect(checkContent(code, "tests/test/unit/pure/foo.ts")).toBe(true);
    });
  });

  describe("valid code and class implementations", () => {
    it("allows class implementations implementing D1Database", () => {
      const code = `
        class MockD1Database implements D1Database {
          prepare(query: string): D1PreparedStatement {
            return {} as any;
          }
          dump(): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(0)); }
          batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Response[]> { return Promise.resolve([]); }
          exec(query: string): Promise<D1ExecResult> { return Promise.resolve({ count: 0, duration: 0 }); }
          withSession(): D1DatabaseSession { return {} as any; }
        }
      `;
      expect(checkContent(code, "test/integration/worker.test.ts")).toBe(true);
    });

    it("allows instantiating classes typed as D1Database", () => {
      const code = `
        const db: D1Database = new MockD1Database();
      `;
      expect(checkContent(code, "test/integration/worker.test.ts")).toBe(true);
    });

    it("allows casting env bindings to D1Database", () => {
      const code = `
        const db = env.DB as D1Database;
      `;
      expect(checkContent(code, "src/worker/pool_routes.ts")).toBe(true);
    });

    it("allows normal functions accepting D1Database parameters", () => {
      const code = `
        export async function recordTelemetry(db: D1Database, event: TelemetryEvent): Promise<void> {
          await db.prepare("INSERT INTO telemetry ...").bind(event.id).run();
        }
      `;
      expect(checkContent(code, "src/storage/d1/ledger.ts")).toBe(true);
    });

    it("allows normal object literals that do not cast to D1Database", () => {
      const code = `
        const config = {
          prepare: true,
          mode: "fast",
        };
      `;
      expect(checkContent(code, "src/config.ts")).toBe(true);
    });
  });
});
