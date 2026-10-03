import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const WP_SH = resolve(ROOT, "scripts/wp.sh");

function initTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wp-g1-test-"));
  execFileSync("git", ["init", "-b", "base"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(
    join(dir, "docs/PROGRESS.md"),
    "### WP-G.1\n- [ ] T-G.1.1 First task\n- [ ] T-G.1.2 Second task\n"
  );
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir });
  execFileSync("git", ["switch", "-c", "wp/WP-G.1"], { cwd: dir });
  return dir;
}

describe("WP-G.1 guardrails", () => {
  it("T-G.1.1: wp.sh selftest passes and forbid() includes all required rules", () => {
    const out = execFileSync("bash", [WP_SH, "selftest"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("selftest ok");

    const script = readFileSync(WP_SH, "utf8");
    expect(script).toContain("swallowed error: log it or rethrow");
    expect(script).toContain("swallowed promise rejection");
    expect(script).toContain("type suppression");
    expect(script).toContain("skipped test");
  });

  it("T-G.1.2: enforces one commit per task, all tasks ticked, and T-[0-9A-Z]+.[0-9]+.[0-9]+ ids", () => {
    const dir = initTempGitRepo();
    try {
      const env = { ...process.env, WP_BASE: "base" };

      // 1. Fails when tasks are unticked
      expect(() =>
        execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
          cwd: dir,
          env,
          encoding: "utf8",
        })
      ).toThrow();

      // Tick both tasks, but commit both in a single multi-task commit subject -> must fail
      writeFileSync(
        join(dir, "docs/PROGRESS.md"),
        "### WP-G.1\n- [x] T-G.1.1 First task\n- [x] T-G.1.2 Second task\n"
      );
      execFileSync("git", ["commit", "-am", "chore(WP-G.1): both T-G.1.1 and T-G.1.2"], {
        cwd: dir,
      });
      expect(() =>
        execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
          cwd: dir,
          env,
          encoding: "utf8",
        })
      ).toThrow(/more than one task id/);

      // Reset and commit only T-G.1.1 -> must fail because T-G.1.2 is missing from commits
      execFileSync("git", ["reset", "--hard", "base"], { cwd: dir });
      writeFileSync(
        join(dir, "docs/PROGRESS.md"),
        "### WP-G.1\n- [x] T-G.1.1 First task\n- [x] T-G.1.2 Second task\n"
      );
      execFileSync("git", ["commit", "-am", "chore(WP-G.1): first (T-G.1.1)"], { cwd: dir });
      expect(() =>
        execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
          cwd: dir,
          env,
          encoding: "utf8",
        })
      ).toThrow(/T-G\.1\.2/);

      // Add second commit for T-G.1.2 -> must pass
      writeFileSync(join(dir, "docs/note.txt"), "done\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-m", "chore(WP-G.1): second (T-G.1.2)"], { cwd: dir });
      const ok = execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      expect(ok).toContain("tasks ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T-G.1.3: requires .wp/red.log entry for feat/fix tasks and exempts chore/docs/refactor/test", () => {
    const gitignore = readFileSync(resolve(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain(".wp/");

    const dir = initTempGitRepo();
    try {
      const env = { ...process.env, WP_BASE: "base" };
      writeFileSync(
        join(dir, "docs/PROGRESS.md"),
        "### WP-G.1\n- [x] T-G.1.1 Feat task\n- [x] T-G.1.2 Chore task\n"
      );
      execFileSync("git", ["commit", "-am", "feat(WP-G.1): new feature (T-G.1.1)"], { cwd: dir });
      writeFileSync(join(dir, "docs/note.txt"), "chore\n");
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-m", "chore(WP-G.1): chore work (T-G.1.2)"], { cwd: dir });

      // Must fail because T-G.1.1 is feat(...) and has no .wp/red.log entry
      expect(() =>
        execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
          cwd: dir,
          env,
          encoding: "utf8",
        })
      ).toThrow(/red\.log.*T-G\.1\.1/);

      // Record red.log entry for T-G.1.1 (T-G.1.2 is chore and exempt)
      mkdirSync(join(dir, ".wp"), { recursive: true });
      writeFileSync(join(dir, ".wp/red.log"), "T-G.1.1 abc1234 test/foo.test.ts\n");

      const ok = execFileSync("bash", [WP_SH, "verify-tasks", "WP-G.1"], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      expect(ok).toContain("tasks ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T-G.1.4: tsconfig.json includes ops/**/* and passes typecheck", () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(ROOT, "tsconfig.json"), "utf8")
    ) as { include?: string[] };
    expect(tsconfig.include).toContain("ops/**/*");

    execFileSync("npm", ["run", "-s", "typecheck"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  });
});
