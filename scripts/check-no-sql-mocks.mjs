#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Checks whether a given file path should be excluded from SQL mock checking.
 * Pure unit tests under test/unit/pure/** are allowed.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isExcluded(filePath) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.startsWith("test/unit/pure/") ||
    normalized.includes("/test/unit/pure/") ||
    normalized === "test/unit/pure" ||
    /(?:^|\/)test\/unit\/pure(?:\/|$)/.test(normalized)
  );
}

/**
 * Finds SQL mock violations in the provided content.
 * Returns an array of violation descriptors with line numbers.
 *
 * @param {string} content
 * @param {string} [filePath]
 * @returns {Array<{ line: number, index: number, match: string }>}
 */
export function findViolations(content, filePath = "") {
  if (isExcluded(filePath)) {
    return [];
  }

  const violations = [];

  // Check 1: Object literals cast to D1Database (handles nested braces)
  const castRegex = /\}\s*as\s*(?:unknown\s*as\s*)?D1Database\b/g;
  let match;
  while ((match = castRegex.exec(content)) !== null) {
    const closeIndex = match.index; // index of "}"
    let depth = 0;
    let openIndex = -1;
    for (let i = closeIndex; i >= 0; i--) {
      if (content[i] === "}") depth++;
      else if (content[i] === "{") {
        depth--;
        if (depth === 0) {
          openIndex = i;
          break;
        }
      }
    }
    if (openIndex !== -1) {
      const objContent = content.slice(openIndex, closeIndex + 1);
      if (/\bprepare\s*:/.test(objContent)) {
        const line = content.slice(0, openIndex).split("\n").length;
        violations.push({ line, index: openIndex, match: objContent.slice(0, 50) });
      }
    }
  }

  // Check 2: Object literals typed as D1Database (handles nested braces)
  const typedRegex = /(?:const|let|var)\s+\w+\s*:\s*D1Database\s*=\s*\{/g;
  while ((match = typedRegex.exec(content)) !== null) {
    const openIndex = match.index + match[0].length - 1; // index of "{"
    let depth = 0;
    let closeIndex = -1;
    for (let i = openIndex; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }
    if (closeIndex !== -1) {
      const objContent = content.slice(openIndex, closeIndex + 1);
      if (/\bprepare\s*:/.test(objContent)) {
        const line = content.slice(0, match.index).split("\n").length;
        if (!violations.some((v) => v.line === line)) {
          violations.push({ line, index: match.index, match: objContent.slice(0, 50) });
        }
      }
    }
  }

  // Check 3: Explicit regexes from the specification
  const regexPatterns = [
    /\{[^}]*\bprepare\s*:[^}]*\}\s*as\s*(?:unknown\s*as\s*)?D1Database/s,
    /prepare\s*:[^,}]*.*as\s+(?:unknown\s+as\s+)?D1Database/s,
    /(?:const|let|var)\s+\w+\s*:\s*D1Database\s*=\s*\{[^}]*\bprepare\s*:/s,
  ];

  for (const regex of regexPatterns) {
    const m = content.match(regex);
    if (m && m.index !== undefined) {
      const line = content.slice(0, m.index).split("\n").length;
      if (!violations.some((v) => v.line === line)) {
        violations.push({ line, index: m.index, match: m[0].slice(0, 50) });
      }
    }
  }

  return violations;
}

/**
 * Checks content for SQL mock violations.
 * Returns false (violation) if content contains an object literal defining prepare property
 * that is cast or typed as D1Database, true otherwise.
 *
 * @param {string} content
 * @param {string} [filePath]
 * @returns {boolean}
 */
export function checkContent(content, filePath = "") {
  return findViolations(content, filePath).length === 0;
}

/**
 * Recursively scans files under 'src/', 'test/', 'tests/'.
 *
 * @param {string} [rootDir]
 * @returns {string[]}
 */
export function scanFiles(rootDir = process.cwd()) {
  const targetDirs = ["src", "test", "tests"];
  const extensions = new Set([".ts", ".js", ".mjs", ".tsx", ".jsx"]);
  const files = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === ".hive"
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  for (const dir of targetDirs) {
    walk(path.resolve(rootDir, dir));
  }

  return files;
}

/**
 * Runs the check across the whole codebase.
 *
 * @param {string} [rootDir]
 * @returns {Array<{ file: string, line: number, match: string }>}
 */
export function runCheck(rootDir = process.cwd()) {
  const files = scanFiles(rootDir);
  const allViolations = [];

  for (const file of files) {
    const relPath = path.relative(rootDir, file).replace(/\\/g, "/");
    if (isExcluded(relPath)) {
      continue;
    }
    const content = fs.readFileSync(file, "utf8");
    const violations = findViolations(content, relPath);
    for (const v of violations) {
      allViolations.push({ file: relPath, line: v.line, match: v.match });
    }
  }

  return allViolations;
}

// CLI execution
const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    import.meta.url === `file://${process.argv[1]}`);

if (isMain) {
  const rootDir = process.cwd();
  const violations = runCheck(rootDir);
  if (violations.length > 0) {
    console.error(`Found ${violations.length} SQL mock violation(s):`);
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}: Object literal defining 'prepare' cast or typed as D1Database is not allowed`
      );
    }
    process.exit(1);
  } else {
    console.log(
      "✓ check-no-sql-mocks passed: no D1Database SQL object literal mocks found."
    );
    process.exit(0);
  }
}
