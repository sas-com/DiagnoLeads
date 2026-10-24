#!/usr/bin/env bun
/**
 * Import boundary check (docs/ARCHITECTURE.md).
 *
 * Usage:
 *   bun run arch:check            # fails on violations that are not on the allowlist
 *   bun run arch:check --update   # rewrites the allowlist to match the code (after removing debt)
 *
 * Existing violations are listed one by one in scripts/architecture/allowlist.json, so new ones
 * fail even when an old one is removed in the same change.
 */

import fs from 'node:fs';
import path from 'node:path';
import { type Allowlist, allowlistFrom, compareWithAllowlist } from './architecture/allowlist';
import { buildImportGraph } from './architecture/graph';
import { RULES } from './architecture/rules';

const ROOT = process.cwd();
const ALLOWLIST_FILE = path.join(ROOT, 'scripts/architecture/allowlist.json');

const update = process.argv.includes('--update');
const graph = buildImportGraph(ROOT);
const violations = new Map(RULES.map((rule) => [rule.id, rule.check(graph)]));

if (update) {
  fs.writeFileSync(ALLOWLIST_FILE, `${JSON.stringify(allowlistFrom(violations), null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, ALLOWLIST_FILE)}`);
  process.exit(0);
}

const allowlist: Allowlist = fs.existsSync(ALLOWLIST_FILE)
  ? JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'))
  : {};
const outcomes = compareWithAllowlist(RULES, violations, allowlist);

let failed = false;
for (const outcome of outcomes) {
  const ok = outcome.added.length === 0 && outcome.resolved.length === 0;
  if (!ok) failed = true;
  const allowed = outcome.total - outcome.added.length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${outcome.id.padEnd(32)} allowlisted ${allowed}`);
  if (outcome.added.length > 0) {
    console.log(`     ${outcome.description}. New:`);
    for (const key of outcome.added) console.log(`       ${key}`);
  }
  if (outcome.resolved.length > 0) {
    console.log('     No longer found (remove from the allowlist with --update):');
    for (const key of outcome.resolved) console.log(`       ${key}`);
  }
}

for (const entry of graph.unresolved) {
  console.log(`note: could not resolve ${entry.spec} in ${entry.from}:${entry.line}`);
}

if (failed) {
  console.log('\nSee docs/ARCHITECTURE.md for the layers and the allowed directions.');
  process.exit(1);
}
