import type { AxMqlRules } from './mql';

/**
 * Business rules for the AX migration diagnosis.
 *
 * Values marked "要確認" are still under review by the business side
 * (see the 要確認事項 slide of the sales & marketing flow) and are kept here
 * so they can be changed without touching the evaluation logic.
 */
export interface AxMigrationConfig {
  /** MQL 条件「業種」: target industries */
  targetIndustries: readonly string[];
  /**
   * MQL 条件「システム」: migration paths that count as legacy systems.
   * AS/400・NEC ACOS・Access（部署単位のツールを含む）を対象にする（2026-10-09, 2026-10-11 決定）
   */
  legacyPlatforms: readonly string[];
  /**
   * For the "other" path: VB・WebPerformer（ローコードはまず WebPerformer）・他社のオフコン・汎用機.
   * その他のローコード製品（other_low_code）とパッケージは当面対象外
   */
  legacyOtherSystems: readonly string[];
  /**
   * 旧ルール（2026-10-09 決定、2026-10-16 に廃止）: Web診断の完了だけで MQL の「行動」に数える。
   * true にすると「適合」だけで MQL（関心あり）になる。元に戻すときのためだけに残す
   */
  countWebDiagnosisAsMqlAction: boolean;
  /**
   * MQL「関心あり」の条件（2026-10-16 オーナー判断, #139）。業種×システム（必須条件）を満たし、
   * 強いシグナルのどれか、または最低スコア以上で「関心あり（MQL）」。必須条件だけなら「適合」。
   * TODO(#139): 具体的な値は営業と決める（要確認）。管理画面はまだないので、ここを変える
   */
  mql: AxMqlRules;
  /** SQL 条件③「検討時期」: timelines that count as "visible" — 要確認 */
  sqlTimelines: readonly string[];
  /** SQL 条件④「検討体制」: roles that give access to decision makers or IT */
  decisionAccessRoles: readonly string[];
  /** 相談申込への連絡期限（営業日） — 要確認 */
  consultationResponseBusinessDays: number;
}

export const AX_MIGRATION_CONFIG: AxMigrationConfig = {
  targetIndustries: ['manufacturing', 'distribution'],
  legacyPlatforms: ['as400', 'acos', 'access'],
  legacyOtherSystems: ['vb', 'webperformer', 'office_computer', 'mainframe'],
  countWebDiagnosisAsMqlAction: false,
  mql: {
    // Access の案件は大企業の1部署を含めて業種・規模を問わず受ける（2026-10-21 オーナー決定, #292）。
    // 相談を勧めるか（recommendation）も同じ扱い。「システム」の条件は変えない
    anyIndustryPlatforms: ['access'],
    anySizePlatforms: ['access'],
    strongSignals: {
      consultation: true,
      // 保守期限・リース満了が過ぎている／1年以内
      supportEnd: ['passed', 'within_1y'],
      // Access / Office のサポート終了済み／1年以内。下の accessSupportWith のどれかと重なったときだけ
      accessSupport: ['ended', 'ending'],
      // Access のサポート終了を強いシグナルにする組み合わせ（2026-10-21 オーナー決定, #292）。
      // 2016〜2021 の買い切り版はすべてサポート終了になり、それだけでは優先度の差が出ないため。
      // 営業と見直すときはここを変える
      accessSupportWith: {
        // 止まったときの影響: 部署の主要な業務／全社・取引先・お客様
        importance: ['main', 'company'],
        // 利用人数: 11人以上
        users: ['11_30', 'gte31'],
        // 基幹システムや SQL Server など、Access の外のデータを直接読み書きしている
        features: ['external_data'],
        // データは SQL Server などのデータベースにあり、Access は画面だけ
        locations: ['database'],
      },
      // 決裁に関わる役職 — 要確認（担当者クラスは含めない）
      roles: ['executive', 'it_manager', 'business_manager'],
      // 切り替えを目指す時期が1年以内 — 要確認
      timelines: ['within_1y'],
    },
    // 使わない（シグナルだけで判定する）— 要確認
    minScore: null,
  },
  sqlTimelines: ['within_1y', '1_2y'],
  // 部署単位の Access は業務部門の部長・課長が決裁することが多い（2026-10-11 レビュー）
  decisionAccessRoles: ['executive', 'it_manager', 'it_staff', 'business_manager'],
  consultationResponseBusinessDays: 2,
};
