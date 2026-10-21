/**
 * Helpers for linking the customer search to leads (#265).
 */

/** Legal-form words that people write in different ways or leave out */
const LEGAL_FORMS =
  /株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|（株）|（有）|㈱|㈲/g;

/** A company name reduced for comparison: width, case, spaces and the legal form removed */
export function normalizeCompany(name: string): string {
  return name
    .normalize('NFKC')
    .replace(LEGAL_FORMS, '')
    .replace(/[\s・.,，。、-]/g, '')
    .toLowerCase();
}

/**
 * Whether two names are probably the same company: equal once normalized, or one contains the
 * other when the shorter is at least 3 characters ("サンプル製作所" and "サンプル製作所 東京工場")
 */
export function sameCompany(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 3 && longer.includes(shorter);
}

const TROUBLE_LABELS: Record<string, string> = {
  few_maintainers: '担当者が少ない・属人化',
  no_documents: '資料がない',
  hard_to_change: '改修・機能追加が難しい',
  maintenance_cost: '保守費用がかさむ',
  data_unusable: 'データを経営に使えない',
};
const SUPPORT_END_LABELS: Record<string, string> = {
  yes: '1年以内',
  no: '1年より先',
  unknown: '不明',
};

/** The note left on the lead: what the employee heard, in the order sales read it */
export function leadNoteFromProspect(prospect: {
  contactedOn: string;
  recorder: string | null;
  department: string | null;
  jobTitle: string | null;
  surname: string | null;
  targetSystem: string | null;
  supportEndSoon: string | null;
  troubles: string[];
  heard: string | null;
}): string {
  const who = [prospect.department, prospect.jobTitle, prospect.surname]
    .filter(Boolean)
    .join(' / ');
  const lines = [
    `顧客探しの記録（${prospect.contactedOn}、${prospect.recorder ?? '記入者不明'}）`,
    who ? `相手: ${who}` : null,
    prospect.targetSystem ? `対象システム: ${prospect.targetSystem}` : null,
    prospect.supportEndSoon
      ? `保守期限: ${SUPPORT_END_LABELS[prospect.supportEndSoon] ?? prospect.supportEndSoon}`
      : null,
    prospect.troubles.length > 0
      ? `困りごと: ${prospect.troubles.map((t) => TROUBLE_LABELS[t] ?? t).join('、')}`
      : null,
    prospect.heard ? `聞いた話: ${prospect.heard}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
