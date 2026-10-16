/**
 * Diagnosis builder: definition hash and change summary of a publish (Refs #114)
 */
import {
  canonicalJson,
  hashDefinition,
  summarizeDefinitionChanges,
} from '@/lib/features/diagnosis-builder/versions';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

describe('canonicalJson / hashDefinition', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    const reordered = Object.fromEntries(Object.entries(cloudReadiness()).reverse());
    expect(hashDefinition(reordered as ReturnType<typeof cloudReadiness>)).toBe(
      hashDefinition(cloudReadiness())
    );
  });

  it('changes with the content and keeps array order significant', () => {
    const def = cloudReadiness();
    const hash = hashDefinition(def);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    def.sections.reverse();
    expect(hashDefinition(def)).not.toBe(hash);
  });
});

describe('summarizeDefinitionChanges', () => {
  it('lists every question as added for the first version', () => {
    const def = cloudReadiness();
    expect(summarizeDefinitionChanges(null, def)).toEqual({
      previousVersion: null,
      questionsAdded: def.questions.map((q) => q.id),
      questionsRemoved: [],
      questionsChanged: [],
      partsChanged: [],
    });
  });

  it('reports added, removed and changed questions and other parts', () => {
    const before = cloudReadiness();
    const after = cloudReadiness();
    const [first, second] = after.questions;
    first.label = '変更後の設問';
    after.questions = after.questions.filter((q) => q.id !== second.id);
    after.questions.push({ id: 'extra', type: 'text', label: '追加', required: false, maxLength: 10 });
    after.axes[0].weight = 5;

    expect(summarizeDefinitionChanges({ version: 2, definition: before }, after, 'メモ')).toEqual({
      previousVersion: 2,
      questionsAdded: ['extra'],
      questionsRemoved: [second.id],
      questionsChanged: [first.id],
      partsChanged: ['axes'],
      note: 'メモ',
    });
  });
});
