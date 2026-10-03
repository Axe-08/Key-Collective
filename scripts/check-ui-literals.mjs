#!/usr/bin/env node
/**
 * Pattern-based guard against invented data in the UI (RA-11, T-F.7.7).
 *
 * Scans ui/src/**\/*.svelte and *.ts (tests and mocks excluded) and rejects:
 *   - ms-in-markup   a number followed by "ms" in Svelte markup ("Sub-15ms", "12ms avg");
 *   - region-id      edge or network ids such as "iad-", "SIN-1", "ASN 13335";
 *   - long-hex       hex strings of 32 or more characters (fake signatures, hashes, secrets);
 *   - email          email address literals;
 *   - score-literal  score literals such as "/ 100</strong>" or "92/100".
 *
 * A finding the team has reviewed and accepted goes in scripts/ui-literals-allowlist.json as
 * { "file", "rule", "match", "reason" }. An allowlist entry that no longer matches fails the run,
 * so the list cannot go stale.
 *
 *   node scripts/check-ui-literals.mjs             self-test, then scan ui/src
 *   node scripts/check-ui-literals.mjs --selftest  self-test only
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const uiDir = path.join(rootDir, "ui/src");
const allowlistPath = path.join(rootDir, "scripts/ui-literals-allowlist.json");

/** Rules applied to every scanned line of .ts files and of .svelte files (script and markup). */
export const RULES = [
  { id: "region-id", regex: /\biad-|\bSIN-\d|\bASN\s?\d/g, message: "Invented edge/region/ASN identifier" },
  { id: "long-hex", regex: /\b[0-9a-fA-F]{32,}\b/g, message: "Hex string of 32+ characters (fake signature, hash or secret)" },
  { id: "email", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, message: "Email address literal" },
  { id: "score-literal", regex: /\/\s?100\s*<\/strong>|\b\d{1,3}\s?\/\s?100\b/g, message: "Score literal out of 100" },
  { id: "microdollars", regex: /microdollars|micro_dollars/gi, message: "Deprecated microdollars currency (use CU)" },
];

/** Applied only to Svelte markup (outside <script> and <style>). */
export const MARKUP_RULES = [
  { id: "ms-in-markup", regex: /\b\d+(?:\.\d+)?\s?ms\b/g, message: "Latency literal in markup" },
];

export function isScanned(relPath) {
  const p = relPath.split(path.sep).join("/");
  if (!/\.(svelte|ts)$/.test(p)) return false;
  if (/\.(test|spec)\.ts$/.test(p)) return false;
  if (/(^|\/)(__mocks__|mocks?|test)\//.test(p)) return false;
  if (/(^|\/)[^/]*mock[^/]*$/i.test(p)) return false;
  return true;
}

/** Line numbers (1-based) that are Svelte markup, i.e. outside <script> and <style> blocks. */
function markupLines(lines) {
  const markup = new Set();
  let inBlock = false;
  lines.forEach((line, i) => {
    const opens = /<(script|style)\b[^>]*>/.test(line);
    const closes = /<\/(script|style)>/.test(line);
    if (!inBlock && opens) {
      inBlock = !closes;
      return;
    }
    if (inBlock) {
      if (closes) inBlock = false;
      return;
    }
    markup.add(i + 1);
  });
  return markup;
}

/** Findings in one file's content: [{ line, rule, match, message, text }]. */
export function findViolations(content, filePath = "file.ts") {
  const lines = content.split("\n");
  const isSvelte = filePath.endsWith(".svelte");
  const markup = isSvelte ? markupLines(lines) : new Set();
  const out = [];
  lines.forEach((text, i) => {
    const rules = markup.has(i + 1) ? [...RULES, ...MARKUP_RULES] : RULES;
    for (const rule of rules) {
      for (const m of text.matchAll(rule.regex)) {
        out.push({ line: i + 1, rule: rule.id, match: m[0], message: rule.message, text: text.trim() });
      }
    }
  });
  return out;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}

export function loadAllowlist(file = allowlistPath) {
  if (!fs.existsSync(file)) return [];
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const e of entries) {
    if (!e.file || !e.rule || !e.match || !e.reason) {
      throw new Error(`Allowlist entry needs file, rule, match and reason: ${JSON.stringify(e)}`);
    }
  }
  return entries;
}

/** Scans ui/src; returns { violations, unusedAllowlist }. */
export function scan(dir = uiDir, allowlist = loadAllowlist()) {
  const used = new Set();
  const violations = [];
  for (const full of walk(dir)) {
    const rel = path.relative(rootDir, full).split(path.sep).join("/");
    if (!isScanned(path.relative(dir, full))) continue;
    for (const v of findViolations(fs.readFileSync(full, "utf8"), rel)) {
      const idx = allowlist.findIndex((e) => e.file === rel && e.rule === v.rule && e.match === v.match);
      if (idx >= 0) used.add(idx);
      else violations.push({ file: rel, ...v });
    }
  }
  const unusedAllowlist = allowlist.filter((_, i) => !used.has(i));
  return { violations, unusedAllowlist };
}

/** Positive and negative samples: every rule must fire on its sample and stay quiet on clean code. */
export const SELFTEST_SAMPLES = {
  positive: [
    ["Comp.svelte", '<span class="text-secondary">Sub-15ms Edge Routing</span>', "ms-in-markup"],
    ["Comp.svelte", "<span>{project.latency || '12ms avg'}</span>", "ms-in-markup"],
    ["Comp.svelte", '<span class="font-mono">&lt; 250ms SLA</span>', "ms-in-markup"],
    ["x.ts", "const cluster = 'iad-edge-01';", "region-id"],
    ["Comp.svelte", "<span>12 (SIN-01)</span>", "region-id"],
    ["x.ts", "**Registration IP:** (Singapore • ASN 13335)", "region-id"],
    ["x.ts", "const sig = 'ed25519:a3f9c0d1e2b4a5f60718293a4b5c6d7e8f9012ab';", "long-hex"],
    ["x.ts", "primaryEmail: userAccount.primaryEmail || 'admin@keycollective.io',", "email"],
    ["Comp.svelte", "<p>Score <strong>92 / 100</strong></p>", "score-literal"],
    ["Comp.svelte", "<strong>{score} / 100</strong>", "score-literal"],
  ],
  negative: [
    ["Comp.svelte", "<script lang=\"ts\">\n  const pollMs = 3000; // 30ms\n</script>\n<p>Latency: {latencyMs}ms</p>", null],
    ["Comp.svelte", '<div class="transition-all duration-300 w-28">Ready</div>', null],
    ["x.ts", "const id = `tok_${crypto.randomUUID()}`;", null],
    ["x.ts", "const short = 'deadbeef';", null],
    ["x.ts", "const pct = Math.round((used / limit) * 100);", null],
    ["Comp.svelte", "<p>{used} of {limit} requests</p>", null],
  ],
};

export function selftest() {
  const failures = [];
  for (const [file, code, rule] of SELFTEST_SAMPLES.positive) {
    if (!findViolations(code, file).some((v) => v.rule === rule)) failures.push(`expected ${rule} on: ${code}`);
  }
  for (const [file, code] of SELFTEST_SAMPLES.negative) {
    const hits = findViolations(code, file);
    if (hits.length > 0) failures.push(`unexpected ${hits.map((h) => h.rule).join(",")} on: ${code}`);
  }
  return failures;
}

function main() {
  const failures = selftest();
  if (failures.length > 0) {
    for (const f of failures) console.error(`[SELFTEST FAIL] ${f}`);
    process.exit(1);
  }
  if (process.argv.includes("--selftest")) {
    console.log("check-ui-literals selftest ok");
    return;
  }
  const { violations, unusedAllowlist } = scan();
  for (const v of violations) {
    console.error(`[FAIL] ${v.file}:${v.line} ${v.rule} "${v.match}" - ${v.message}\n  Line: ${v.text}`);
  }
  for (const e of unusedAllowlist) {
    console.error(`[STALE ALLOWLIST] ${e.file} ${e.rule} "${e.match}" no longer occurs; remove the entry.`);
  }
  if (violations.length > 0 || unusedAllowlist.length > 0) {
    console.error("\nInvented-data literals found in ui/src. Fix them, or add a reviewed entry to scripts/ui-literals-allowlist.json.");
    process.exit(1);
  }
  console.log("No invented UI literals found.");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) main();
