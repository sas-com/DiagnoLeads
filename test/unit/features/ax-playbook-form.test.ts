/**
 * Settings form <-> stored playbook conversion (Refs #74).
 */
import { describe, expect, it } from 'vitest';
import { fromAxPlaybookForm, toAxPlaybookForm } from '@/lib/features/ax-playbook/form';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';

describe('ax playbook form', () => {
  it('round-trips stored content', () => {
    const content = emptyAxPlaybookContent();
    content.challenges.people = { effect: 'E', questions: ['Q1', 'Q2'], signals: ['S'] };
    content.basicChecks = ['B1'];
    content.objections = [{ customer: 'C', response: 'R', note: 'N', reasons: [] }];
    content.ngPhrases = [{ ng: 'NG', alternative: 'OK', reasons: [] }];
    content.escalations = [{ topic: 'T', contact: 'DX' }];

    expect(fromAxPlaybookForm(toAxPlaybookForm(content))).toEqual(content);
  });

  it('splits lists by line, trimming and dropping blank lines', () => {
    const form = toAxPlaybookForm(emptyAxPlaybookContent());
    form.challenges.cost.questions = '  Q1 \n\n Q2\n   ';
    form.basicChecks = '\nB1\n';

    const content = fromAxPlaybookForm(form);

    expect(content.challenges.cost.questions).toEqual(['Q1', 'Q2']);
    expect(content.basicChecks).toEqual(['B1']);
  });

  it('drops table rows left entirely blank but keeps partly filled ones', () => {
    const form = toAxPlaybookForm(emptyAxPlaybookContent());
    form.objections = [
      { customer: ' ', response: '', note: '', reasons: [] },
      { customer: 'C', response: '', note: '', reasons: [] },
    ];

    expect(fromAxPlaybookForm(form).objections).toEqual([{ customer: 'C', response: '', note: '', reasons: [] }]);
  });

  it('does not share row objects with the stored content', () => {
    const content = emptyAxPlaybookContent();
    content.ngPhrases = [{ ng: 'NG', alternative: 'OK', reasons: [] }];
    const form = toAxPlaybookForm(content);
    form.ngPhrases[0].ng = 'changed';
    expect(content.ngPhrases[0].ng).toBe('NG');
  });
});
