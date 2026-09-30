#!/usr/bin/env node
// scripts/qa/purge_all_keys.mjs
//
// QA-only helper to purge all upstream API keys from a D1 database.
// This intentionally refuses to run against the production database
// (key-collective-d1) to prevent accidental data loss.
//
// Usage:
//   node scripts/qa/purge_all_keys.mjs --db <name>
//   DB_NAME=<name> node scripts/qa/purge_all_keys.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PRODUCTION_DB_NAME = "key-collective-d1";

function resolveDbName(argv) {
  const flagIndex = argv.indexOf("--db");
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }
  if (process.env.DB_NAME) {
    return process.env.DB_NAME;
  }
  return undefined;
}

function main() {
  const dbName = resolveDbName(process.argv.slice(2));

  if (!dbName) {
    console.error(
      "purge_all_keys: missing target database. Pass --db <name> or set DB_NAME.",
    );
    process.exit(1);
    return;
  }

  if (dbName === PRODUCTION_DB_NAME) {
    console.error(
      `purge_all_keys: refusing to run against production database "${PRODUCTION_DB_NAME}".`,
    );
    process.exit(1);
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sqlFile = path.join(__dirname, "purge_all_keys.sql");

  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", dbName, "--remote", "--file", sqlFile],
    { stdio: "inherit" },
  );
}

main();
