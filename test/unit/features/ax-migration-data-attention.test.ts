import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import {
  attentionDataKinds,
  dataAttentionSummary,
  dataKindLabels,
} from '@/lib/features/diagnostics/ax-migration/data-attention';
import { ACCESS_DATA_KINDS_QUESTION } from '@/lib/features/diagnostics/ax-migration/data-kinds';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { shouldSendInAppNotification } from '@/lib/features/notifications/notification-service';
import { accessAnswers } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

const options =
  axMigrationDefinition.questions
    .find((question) => question.id === ACCESS_DATA_KINDS_QUESTION)
    ?.options.map((option) => option.value) ?? [];

describe('data that needs care in an Access tool (#828)', () => {
  it('flags My Number, special care and card or account data, all choices of the question', () => {
    expect([...AX_MIGRATION_CONFIG.accessDataKindsToFlag].sort()).toEqual(
      ['my_number', 'payment', 'sensitive'].sort()
    );
    for (const kind of AX_MIGRATION_CONFIG.accessDataKindsToFlag) {
      expect(options).toContain(kind);
    }
  });

  it('picks the flagged kinds in the order the question lists them', () => {
    expect(
      attentionDataKinds({
        ...accessAnswers,
        access_data_kinds: ['payment', 'customer', 'my_number', 'sensitive', 'unknown'],
      })
    ).toEqual(['sensitive', 'my_number', 'payment']);
    expect(
      attentionDataKinds({ ...accessAnswers, access_data_kinds: ['customer', 'confidential'] })
    ).toEqual([]);
    expect(attentionDataKinds(accessAnswers)).toEqual([]);
    expect(attentionDataKinds({ access_data_kinds: 'my_number' })).toEqual([]);
  });

  it('keeps the summary only once the question is answered, empty when nothing is flagged', () => {
    expect(dataAttentionSummary({ ...accessAnswers, access_data_kinds: ['my_number'] })).toEqual({
      dataAttention: ['my_number'],
    });
    expect(dataAttentionSummary({ ...accessAnswers, access_data_kinds: ['none'] })).toEqual({
      dataAttention: [],
    });
    expect(dataAttentionSummary(accessAnswers)).toEqual({});
  });

  it('names the kinds in the words of the question', () => {
    expect(dataKindLabels(['sensitive', 'my_number', 'payment'])).toEqual([
      '健康・病歴など、特に配慮が要る個人情報',
      'マイナンバー',
      'クレジットカードの番号や銀行口座',
    ]);
    expect(dataKindLabels(['unknown_kind'])).toEqual(['unknown_kind']);
  });

  it('reaches people whatever their settings, like a restriction on AI analysis (#160)', () => {
    const allOff = Object.fromEntries(
      [
        'inAppLeadCreated',
        'inAppLeadStatusChanged',
        'inAppLeadScored',
        'inAppImportExport',
        'inAppMemberChanges',
        'inAppConsultationRequested',
        'inAppAssignedToMe',
        'inAppNextActionDue',
      ].map((key) => [key, false])
    ) as unknown as Parameters<typeof shouldSendInAppNotification>[1];
    expect(shouldSendInAppNotification('data_attention', allOff)).toBe(true);
    expect(shouldSendInAppNotification('lead_scored', allOff)).toBe(false);
  });
});
