#!/usr/bin/env bun
/**
 * Import boundary check (docs/ARCHITECTURE.md).
 *
 * Usage:
 *   bun run arch:check            # fails on violations that are not on the allowlist
 *   bun run arch:check --update   # rewrites the allowlist to match the code (after removing debt)
 *
 * Existing violations are listed one by one in scripts/architecture/allowlist.txt, so a new one
 * fails even when an old one is removed in the same change.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compareWithAllowlist, formatAllowlist, parseAllowlist } from './architecture/allowlist';
import { buildImportGraph } from './architecture/graph';
import { RULES } from './architecture/rules';

const ROOT = process.cwd();
const ALLOWLIST_FILE = path.join(ROOT, 'scripts/architecture/allowlist.txt');

const update = process.argv.includes('--update');
const graph = buildImportGraph(ROOT);
const violations = new Map(RULES.map((rule) => [rule.id, rule.check(graph)]));
const allowlist = parseAllowlist(
  fs.existsSync(ALLOWLIST_FILE) ? fs.readFileSync(ALLOWLIST_FILE, 'utf8') : ''
);

if (update) {
  const text = formatAllowlist(RULES, violations);
  fs.writeFileSync(ALLOWLIST_FILE, text);
  console.log(`Wrote ${path.relative(ROOT, ALLOWLIST_FILE)}`);
  // A new line is an exception that needs a reason in the PR, so it is never added silently
  const written = parseAllowlist(text);
  const missingFrom = (from: Map<string, Set<string>>, to: Map<string, Set<string>>) =>
    [...from].flatMap(([id, items]) =>
      [...items].filter((item) => !to.get(id)?.has(item)).map((item) => `${id} ${item}`)
    );
  for (const line of missingFrom(written, allowlist)) {
    console.log(`added (write the reason in the PR): ${line}`);
  }
  for (const line of missingFrom(allowlist, written)) console.log(`removed: ${line}`);
  const blocked = RULES.filter((rule) => rule.mode === 'error' && violations.get(rule.id)?.length);
  for (const rule of blocked) {
    console.log(`FAIL ${rule.id}: ${rule.description}. This rule has no allowlist. Fix:`);
    for (const item of violations.get(rule.id) ?? []) console.log(`       ${item}`);
  }
  process.exit(blocked.length > 0 ? 1 : 0);
}

const outcomes = compareWithAllowlist(RULES, violations, allowlist);

let failed = false;
for (const outcome of outcomes) {
  const ok = outcome.added.length === 0 && outcome.resolved.length === 0;
  if (!ok) failed = true;
  const allowed = outcome.total - outcome.added.length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${outcome.id.padEnd(32)} allowlisted ${allowed}`);
  if (outcome.added.length > 0) {
    console.log(`     ${outcome.description}. New:`);
    for (const item of outcome.added) console.log(`       ${item}`);
  }
  if (outcome.resolved.length > 0) {
    console.log('     No longer found. Run bun run arch:check --update to drop:');
    for (const item of outcome.resolved) console.log(`       ${item}`);
  }
}

for (const entry of graph.unresolved) {
  console.log(`note: could not resolve ${entry.spec} in ${entry.from}:${entry.line}`);
}

if (failed) {
  console.log(
    '\nSee docs/ARCHITECTURE.md for the layers, the allowed imports and how to fix this.'
  );
  process.exit(1);
}
