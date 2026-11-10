/**
 * Initial field_glossary content (Epic #780 P2). Grounded reference text for fields whose meaning
 * is already fixed by a decision, so no marketing/sales wording is pending. Labels stay in
 * locales/ (canonical), so entries carry descriptions only — not labels (#800). Seeded
 * idempotently by scripts/seed-field-glossary.ts; operators edit afterwards via
 * settings/field-glossary.
 *
 * leads.status: the 5-stage pipeline (decision 2026-10-09-lead-pipeline-status). The field-level
 * entry summarizes the stages; the value entries explain each one (shown per value as screens are
 * wired up in later P2 slices).
 */

export interface FieldGlossarySeedEntry {
  /** e.g. 'leads.status' */
  fieldKey: string;
  /** null = the field-level entry; a value = that value's entry */
  value: string | null;
  descriptionJa: string;
  descriptionEn: string;
  sortOrder: number;
}

export const FIELD_GLOSSARY_SEED: readonly FieldGlossarySeedEntry[] = [
  {
    fieldKey: 'leads.status',
    value: null,
    sortOrder: 0,
    descriptionJa:
      'リードの営業段階です。新規 → ナーチャリング → 商談中 → 成約／失注 と進みます。商談のあるリードの状態は、商談のステージから自動で決まります。',
    descriptionEn:
      "The lead's sales stage: New → Nurturing → Negotiating → Won / Lost. For a lead that has deals, the status is set automatically from the deal stage.",
  },
  {
    fieldKey: 'leads.status',
    value: 'new',
    sortOrder: 1,
    descriptionJa: '新しく入ったリードです。まだ本格的な接触やナーチャリングの前の段階です。',
    descriptionEn: 'A newly captured lead, before serious contact or nurturing.',
  },
  {
    fieldKey: 'leads.status',
    value: 'nurturing',
    sortOrder: 2,
    descriptionJa:
      'すぐには商談にならないものの、継続して関係を育てている段階です。保留中のリードもここに含みます。',
    descriptionEn:
      'Being nurtured — not ready for a deal yet. Leads put on hold are included here.',
  },
  {
    fieldKey: 'leads.status',
    value: 'negotiating',
    sortOrder: 3,
    descriptionJa: '商談・ヒアリングが進行中の段階です。SQL判定はこれとは別に記録します。',
    descriptionEn: 'A deal or hearing is in progress. SQL qualification is recorded separately.',
  },
  {
    fieldKey: 'leads.status',
    value: 'won',
    sortOrder: 4,
    descriptionJa: '受注した状態です。次の商談（移行など）が進行中でも成約のままです。',
    descriptionEn:
      'Won. A lead stays won even while its next deal (for example the migration) is in progress.',
  },
  {
    fieldKey: 'leads.status',
    value: 'lost',
    sortOrder: 5,
    descriptionJa:
      '商談が不成立だった状態です。「保留」は失注ではなくナーチャリングとして扱います。',
    descriptionEn: 'Lost. Note that "on hold" is treated as nurturing, not as lost.',
  },
];
