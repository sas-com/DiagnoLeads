/** Violations that existed when a rule was introduced, keyed by rule id. */
export type Allowlist = Record<string, string[]>;

export interface RuleOutcome {
  id: string;
  description: string;
  /** Violations that are not on the allowlist: these fail the check. */
  added: string[];
  /** Allowlist entries that no longer occur: remove them so the debt cannot come back. */
  resolved: string[];
  total: number;
}

export function compareWithAllowlist(
  rules: { id: string; description: string }[],
  violations: Map<string, string[]>,
  allowlist: Allowlist
): RuleOutcome[] {
  return rules.map((rule) => {
    const current = violations.get(rule.id) ?? [];
    const allowed = new Set(allowlist[rule.id] ?? []);
    const found = new Set(current);
    return {
      id: rule.id,
      description: rule.description,
      added: current.filter((key) => !allowed.has(key)),
      resolved: [...allowed].filter((key) => !found.has(key)).sort(),
      total: current.length,
    };
  });
}

/** The allowlist that matches the current code: only rules with violations, keys sorted. */
export function allowlistFrom(violations: Map<string, string[]>): Allowlist {
  const result: Allowlist = {};
  for (const [id, keys] of [...violations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (keys.length > 0) result[id] = [...keys].sort();
  }
  return result;
}
