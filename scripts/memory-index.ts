/**
 * Prints the index of MemoryBank decisions in full: the active ones (as Claude Code sees them at
 * session start, without its length budget) and the superseded ones with their replacements.
 * `bun run memory:index`
 */
import { join, resolve } from 'node:path';
import { DECISIONS_DIR, formatIndex, loadDecisions } from '../.claude/hooks/lib/decisions';

const root = resolve(import.meta.dirname, '..');
const decisions = loadDecisions(join(root, DECISIONS_DIR));
const superseded = decisions.filter((d) => d.status === 'superseded');

console.log(formatIndex(decisions, Number.POSITIVE_INFINITY));
if (superseded.length > 0) {
  console.log('\n## 置き換え済み');
  for (const d of superseded) {
    console.log(`- ${d.id} [${d.category}] ${d.title} → ${d.supersededBy.join(', ')}`);
  }
}
