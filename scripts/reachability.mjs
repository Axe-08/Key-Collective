#!/usr/bin/env node
/**
 * @file scripts/reachability.mjs
 * Scans src/ for non-test .ts files, builds the import graph from src/index.ts
 * and all test files (test/, tests/, src/ test files),
 * and exits 1 if any non-test source file in src/ is unreachable.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

function collectFiles(dir, predicate = () => true) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

function isTestFile(filePath) {
  return /\.(test|spec)\.ts$/.test(filePath);
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const baseDir = path.dirname(fromFile);
  const rawTarget = path.resolve(baseDir, spec);
  const candidates = [
    rawTarget,
    `${rawTarget}.ts`,
    path.join(rawTarget, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const resolved = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const spec = match[1] || match[2];
    if (!spec) continue;
    const target = resolveImport(filePath, spec);
    if (target) {
      resolved.push(target);
    }
  }
  return resolved;
}

const allSrcFiles = collectFiles(
  SRC_DIR,
  (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !isTestFile(f)
);

const rootSeeds = [
  path.join(SRC_DIR, "index.ts"),
  ...collectFiles(SRC_DIR, (f) => isTestFile(f)),
  ...collectFiles(path.join(ROOT, "test"), (f) => f.endsWith(".ts")),
  ...collectFiles(path.join(ROOT, "tests"), (f) => f.endsWith(".ts")),
].filter((f) => fs.existsSync(f));

const visited = new Set();
const queue = [...rootSeeds];

while (queue.length > 0) {
  const current = queue.pop();
  if (!current || visited.has(current)) continue;
  visited.add(current);
  for (const dep of extractImports(current)) {
    if (!visited.has(dep)) {
      queue.push(dep);
    }
  }
}

const unreachable = allSrcFiles
  .filter((f) => !visited.has(f))
  .map((f) => path.relative(ROOT, f))
  .sort();

if (unreachable.length > 0) {
  console.error(`Unreachable source files (${unreachable.length}):`);
  for (const rel of unreachable) {
    console.error(`  - ${rel}`);
  }
  process.exit(1);
}

console.log(`Reachability check passed: ${allSrcFiles.length} source files reachable.`);
