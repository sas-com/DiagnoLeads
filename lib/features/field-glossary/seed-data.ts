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
  // leads.dealPhase — the deal phases (docs/PIPELINE_LIFECYCLE.md §2.2, DEAL_PHASES)
  {
    fieldKey: 'leads.dealPhase',
    value: null,
    sortOrder: 0,
    descriptionJa:
      '商談の進み具合を表すフェーズです。初回ヒアリング → 簡易診断 → 提案 と進み、受注は現行調査受注 → 移行受注 → AX化 の段階で入ります。商談のあるリードでは、商談のステージから自動で決まります。',
    descriptionEn:
      'The phase of the deal: Initial hearing → Simple diagnosis → Proposal, and a win advances through Survey won → Migration won → AX. For a lead with deals, it is set automatically from the deal stage.',
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'initial_hearing',
    sortOrder: 1,
    descriptionJa: '初回ヒアリングの段階（見極め）です。この出口で SQL判定を記録します。',
    descriptionEn: 'Initial hearing (qualification). SQL qualification is recorded at its exit.',
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'simple_diagnosis',
    sortOrder: 2,
    descriptionJa: '課題を確認する簡易診断の段階です。',
    descriptionEn: "Simple diagnosis — confirming the customer's issues.",
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'proposal',
    sortOrder: 3,
    descriptionJa: '提案・条件の調整の段階です。',
    descriptionEn: 'Proposal and terms.',
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'survey_won',
    sortOrder: 4,
    descriptionJa: '現行調査の受注です（受注の1段目）。',
    descriptionEn: 'Current-state survey won (first win stage).',
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'migration_won',
    sortOrder: 5,
    descriptionJa: '移行の受注です（受注の2段目）。',
    descriptionEn: 'Migration won (second win stage).',
  },
  {
    fieldKey: 'leads.dealPhase',
    value: 'ax',
    sortOrder: 6,
    descriptionJa: 'AX化の受注です（受注の3段目）。',
    descriptionEn: 'AX migration won (third win stage).',
  },
  // leads.conversionPoint — where the lead converted (CONVERSION_POINTS)
  {
    fieldKey: 'leads.conversionPoint',
    value: null,
    sortOrder: 0,
    descriptionJa:
      '診断フォームやサイトで、どの接点から反応・申込があったか（コンバージョンポイント）です。',
    descriptionEn: 'The point where the lead converted — where they responded or applied.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'consultation',
    sortOrder: 1,
    descriptionJa: '相談の申込。',
    descriptionEn: 'Requested a consultation.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'document_download',
    sortOrder: 2,
    descriptionJa: '資料のダウンロード。',
    descriptionEn: 'Downloaded a document.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'demo_view',
    sortOrder: 3,
    descriptionJa: 'デモの閲覧。',
    descriptionEn: 'Viewed a demo.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'seminar',
    sortOrder: 4,
    descriptionJa: 'セミナーへの参加。',
    descriptionEn: 'Attended a seminar.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'via_sales',
    sortOrder: 5,
    descriptionJa: '営業経由。',
    descriptionEn: 'Came in via sales.',
  },
  {
    fieldKey: 'leads.conversionPoint',
    value: 'web_diagnosis',
    sortOrder: 6,
    descriptionJa: 'Web 診断の回答。',
    descriptionEn: 'Completed the web diagnosis.',
  },
  // leads.inflowSource — where the lead came from (INFLOW_SOURCES). Generic categories only; the
  // agency name and cost of an outsourced lead live on the lead, not here.
  {
    fieldKey: 'leads.inflowSource',
    value: null,
    sortOrder: 0,
    descriptionJa: 'リードの流入元（どこから来たか）です。',
    descriptionEn: 'Where the lead came from.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'existing_customer',
    sortOrder: 1,
    descriptionJa: '既存顧客。',
    descriptionEn: 'An existing customer.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'referral_partner',
    sortOrder: 2,
    descriptionJa: '紹介パートナー。',
    descriptionEn: 'A referral partner.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'executive_network',
    sortOrder: 3,
    descriptionJa: '経営層のネットワーク。',
    descriptionEn: "An executive's network.",
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'lp_organic',
    sortOrder: 4,
    descriptionJa: 'ランディングページへの自然流入。',
    descriptionEn: 'Organic arrival at a landing page.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'seminar',
    sortOrder: 5,
    descriptionJa: 'セミナー。',
    descriptionEn: 'A seminar.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'advertising',
    sortOrder: 6,
    descriptionJa: '広告。',
    descriptionEn: 'Advertising.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'telemarketing_agency',
    sortOrder: 7,
    descriptionJa: '営業代行会社によるテレアポ。代行会社名と獲得費用はリードに記録します。',
    descriptionEn:
      'A telemarketing agency. The agency name and acquisition cost are recorded on the lead.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'referral_agency',
    sortOrder: 8,
    descriptionJa: '紹介代行会社からの紹介。代行会社名と費用はリードに記録します。',
    descriptionEn: 'A referral agency. The agency name and cost are recorded on the lead.',
  },
  {
    fieldKey: 'leads.inflowSource',
    value: 'member_referral',
    sortOrder: 9,
    descriptionJa: '社員自身の紹介（社員の診断リンクや顧客探しの行）。紹介者はその社員です。',
    descriptionEn:
      "A member's own referral (their diagnosis link or prospect row); the referrer is the member.",
  },
  // leads.targetSystem — the legacy system to migrate from (TARGET_SYSTEMS)
  {
    fieldKey: 'leads.targetSystem',
    value: null,
    sortOrder: 0,
    descriptionJa: '移行元の既存システムの種類です。',
    descriptionEn: 'The kind of legacy system being migrated from.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'as400',
    sortOrder: 1,
    descriptionJa: 'IBM AS/400（IBM i）。',
    descriptionEn: 'IBM AS/400 (IBM i).',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'acos',
    sortOrder: 2,
    descriptionJa: 'NEC ACOS。',
    descriptionEn: 'NEC ACOS.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'other_legacy',
    sortOrder: 3,
    descriptionJa: 'その他のオフコン・汎用機。',
    descriptionEn: 'Other office computers or mainframes.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'vb',
    sortOrder: 4,
    descriptionJa: 'VB のクライアント/サーバー。',
    descriptionEn: 'A VB client-server system.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'access',
    sortOrder: 5,
    descriptionJa: 'Microsoft Access（部署単位のツールを含む）。',
    descriptionEn: 'Microsoft Access (including department-level tools).',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'webperformer',
    sortOrder: 6,
    descriptionJa: 'WebPerformer（ローコード）。',
    descriptionEn: 'WebPerformer (low-code).',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'custom_open',
    sortOrder: 7,
    descriptionJa: '自社開発のオープン系システム。',
    descriptionEn: 'An in-house open system.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'package',
    sortOrder: 8,
    descriptionJa: 'パッケージ製品。',
    descriptionEn: 'A packaged product.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'unknown',
    sortOrder: 9,
    descriptionJa: '不明。',
    descriptionEn: 'Unknown.',
  },
  {
    fieldKey: 'leads.targetSystem',
    value: 'other',
    sortOrder: 10,
    descriptionJa: 'その他。',
    descriptionEn: 'Other.',
  },
  // leads.lostReason — reason for a loss or hold (LOST_REASONS). On hold is nurturing, not lost.
  {
    fieldKey: 'leads.lostReason',
    value: null,
    sortOrder: 0,
    descriptionJa: '失注または保留の理由です。「保留」は失注ではなくナーチャリングとして扱います。',
    descriptionEn: 'The reason for a loss or hold. "On hold" is treated as nurturing, not as lost.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'budget',
    sortOrder: 1,
    descriptionJa: '予算が合わなかった。',
    descriptionEn: 'Budget.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'timing',
    sortOrder: 2,
    descriptionJa: '時期が合わなかった。',
    descriptionEn: 'Timing.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'competitor',
    sortOrder: 3,
    descriptionJa: '競合に決まった。',
    descriptionEn: 'Lost to a competitor.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'internal_structure',
    sortOrder: 4,
    descriptionJa: '社内体制・意思決定の事情。',
    descriptionEn: 'Internal structure or decision-making.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'system_out_of_scope',
    sortOrder: 5,
    descriptionJa: '対象のシステムが範囲外だった。',
    descriptionEn: 'The system was out of scope.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'no_decision_maker',
    sortOrder: 6,
    descriptionJa: '決裁者に届かなかった。',
    descriptionEn: 'No access to a decision-maker.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'no_need',
    sortOrder: 7,
    descriptionJa: 'ニーズがなかった。',
    descriptionEn: 'No need.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'on_hold',
    sortOrder: 8,
    descriptionJa: '保留（今は進まない）。ナーチャリングとして追います。',
    descriptionEn: 'On hold — not progressing now; tracked as nurturing.',
  },
  {
    fieldKey: 'leads.lostReason',
    value: 'other',
    sortOrder: 9,
    descriptionJa: 'その他。',
    descriptionEn: 'Other.',
  },
];
