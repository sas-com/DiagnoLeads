/** Violations that existed when a rule was introduced, keyed by rule id. */
export type Allowlist = Map<string, Set<string>>;

const HEADER = `# Import boundary violations that existed before the rule (docs/ARCHITECTURE.md).
# One "<rule> <item>" per line, sorted. Only remove lines: bun run arch:check --update rewrites
# this file after a change takes debt away. A new line needs a reason in the PR.
`;

export interface RuleOutcome {
  id: string;
  description: string;
  /** Violations that are not on the allowlist: these fail the check. */
  added: string[];
  /** Allowlist entries that no longer occur: remove them so the debt cannot come back. */
  resolved: string[];
  total: number;
}

export function parseAllowlist(text: string): Allowlist {
  const allowlist: Allowlist = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const space = line.indexOf(' ');
    const id = space === -1 ? line : line.slice(0, space);
    const item = space === -1 ? '' : line.slice(space + 1).trim();
    const set = allowlist.get(id) ?? new Set<string>();
    set.add(item);
    allowlist.set(id, set);
  }
  return allowlist;
}

type RuleMode = { id: string; description: string; mode: 'error' | 'allowlist' };

/**
 * The allowlist that matches the current code: one line per violation, sorted. Only rules in
 * allowlist mode are written, so --update cannot let a violation of an error rule through.
 */
export function formatAllowlist(rules: RuleMode[], violations: Map<string, string[]>): string {
  const lines = rules
    .filter((rule) => rule.mode === 'allowlist')
    .flatMap((rule) => (violations.get(rule.id) ?? []).map((item) => `${rule.id} ${item}`));
  return `${HEADER}${lines.sort().join('\n')}\n`;
}

export function compareWithAllowlist(
  rules: RuleMode[],
  violations: Map<string, string[]>,
  allowlist: Allowlist
): RuleOutcome[] {
  return rules.map((rule) => {
    const current = violations.get(rule.id) ?? [];
    // Lines for an error rule are never honoured; they show up as entries to remove
    const listed = allowlist.get(rule.id) ?? new Set<string>();
    const allowed = rule.mode === 'allowlist' ? listed : new Set<string>();
    const found = new Set(current);
    return {
      id: rule.id,
      description: rule.description,
      added: current.filter((item) => !allowed.has(item)),
      resolved: [...listed].filter((item) => !allowed.has(item) || !found.has(item)).sort(),
      total: current.length,
    };
  });
}
