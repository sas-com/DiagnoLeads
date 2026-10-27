import type {
  DiagnosticDefinition,
  DiagnosticOption,
  DiagnosticQuestion,
  LocalizedText,
} from '../types';
import { AX_COMPANY_SIZE_OPTIONS } from './company-size';

/**
 * AX migration self-diagnosis (Webセルフ診断)
 *
 * Source: AX migration sales & marketing flow (2026-10-08). The first question chooses the
 * migration path (AS/400, NEC ACOS, Access, other); each path asks what that migration needs.
 * Burden rules (2026-10-11): about 10 required multiple-choice questions per path, ranges
 * instead of numbers, "I don't know" on every technical question, plain-word hints, and the
 * detailed questions (`detail`) only after the result.
 */
export const AX_MIGRATION_DIAGNOSTIC_KEY = 'ax-migration';

const text = (ja: string, en: string): LocalizedText => ({ ja, en });
const option = (value: string, ja: string, en: string, hint?: LocalizedText): DiagnosticOption =>
  hint ? { value, label: text(ja, en), hint } : { value, label: text(ja, en) };
const unknown = option('unknown', 'わからない', "I don't know");
const roughly = text('おおよそで構いません。', 'A rough figure is fine.');

const single = (
  id: string,
  label: LocalizedText,
  options: DiagnosticOption[],
  extra: Partial<DiagnosticQuestion> = {}
): DiagnosticQuestion => ({ id, type: 'single', required: true, label, options, ...extra });

const multiple = (
  id: string,
  label: LocalizedText,
  options: DiagnosticOption[],
  exclusiveOptions: string[],
  extra: Partial<DiagnosticQuestion> = {}
): DiagnosticQuestion => ({
  id,
  type: 'multiple',
  required: true,
  label,
  options,
  exclusiveOptions,
  ...extra,
});

/** Optional follow-up asked after the result */
const detail = { required: false, detail: true } as const;

/** Optional question asked before the result (company size, #150) */
const optional = { required: false } as const;
const sizeUnknown = option(
  'unknown',
  'わからない・答えたくない',
  "I don't know / prefer not to say"
);
const sizeNote = text(
  'ご提案の規模を考えるために使います。わからない場合や答えたくない場合は、空欄のままでも構いません。',
  'Used to size our proposal. You may leave it blank.'
);

/** Labels of the company size ranges, in the order of AX_COMPANY_SIZE_OPTIONS */
const COMPANY_SIZE_LABELS: Record<keyof typeof AX_COMPANY_SIZE_OPTIONS, [string, string][]> = {
  annual_revenue: [
    ['10億円未満', 'Under 1 billion yen'],
    ['10億〜30億円未満', '1-3 billion yen'],
    ['30億〜100億円未満', '3-10 billion yen'],
    ['100億〜300億円未満', '10-30 billion yen'],
    ['300億円以上', '30 billion yen or more'],
  ],
  employees: [
    ['50名未満', 'Under 50'],
    ['50〜299名', '50-299'],
    ['300〜999名', '300-999'],
    ['1,000名以上', '1,000 or more'],
  ],
  sites: [
    ['1か所', 'One'],
    ['2〜4か所', '2-4'],
    ['5〜9か所', '5-9'],
    ['10か所以上', '10 or more'],
  ],
};

const sizeOptions = (question: keyof typeof AX_COMPANY_SIZE_OPTIONS): DiagnosticOption[] => [
  ...AX_COMPANY_SIZE_OPTIONS[question].map((value, index) => {
    const [ja, en] = COMPANY_SIZE_LABELS[question][index];
    return option(value, ja, en);
  }),
  sizeUnknown,
];

export const AX_PLATFORMS = ['as400', 'acos', 'access', 'other'] as const;
export type AxPlatform = (typeof AX_PLATFORMS)[number];

const questions: DiagnosticQuestion[] = [
  // ── Migration path ────────────────────────────────────────────────────────────
  single(
    'platform',
    text('移行を検討しているシステムは？', 'Which system are you thinking of migrating?'),
    [
      option(
        'as400',
        'AS/400（IBM i）',
        'AS/400 (IBM i)',
        text(
          'IBM製の基幹システム。iSeries・System i・IBM Powerとも呼ばれ、黒い画面に緑や白の文字で操作します',
          'IBM business system, also called iSeries, System i or IBM Power, used on a black screen with green or white text'
        )
      ),
      option(
        'acos',
        'NEC ACOS',
        'NEC ACOS',
        text(
          'NECの汎用機（ACOS‑2・ACOS‑4）。機種名はi‑PX7300・i‑PX9800・i‑PX AKATSUKIなど',
          'NEC mainframe (ACOS-2, ACOS-4), such as i-PX7300, i-PX9800 and i-PX AKATSUKI'
        )
      ),
      option(
        'access',
        'Microsoft Access',
        'Microsoft Access',
        text(
          '部署などで作ったAccessのツール（.mdb・.accdbのファイル）',
          'Access tools built by a department (.mdb / .accdb files)'
        )
      ),
      option(
        'other',
        'その他・わからない',
        'Other / not sure',
        text(
          'Visual Basicのシステム、WebPerformer、NECのオフコン（A‑VX・ITOS）、他社のオフコン・汎用機など',
          'Visual Basic systems, WebPerformer, NEC office computers (A-VX, ITOS), other office computers or mainframes'
        )
      ),
    ]
  ),

  // ── Shared by the server-based paths (AS/400, ACOS, other) ────────────────────
  // Reviewed by the AS/400 and ACOS migration specialists (2026-10-11)
  single(
    'maintenance',
    text('今のシステムを直せる（改修できる）人は？', 'Who can change the current system?'),
    [
      option(
        'retiring',
        '社内の1〜2名に頼っていて、数年のうちに退職・異動の予定がある',
        'One or two people in-house, who will retire or move within a few years'
      ),
      option(
        'few',
        '社内の1〜2名に頼っている（当面は続けられる）',
        'One or two people in-house (fine for now)'
      ),
      option(
        'team',
        '社内に3名以上いる、または社内と保守会社の両方で対応できる',
        'Three or more people in-house, or both in-house staff and a maintenance company'
      ),
      option(
        'vendor',
        '保守会社に任せていて、社内に直せる人はいない',
        'A maintenance company only; nobody in-house can change it'
      ),
      option(
        'none',
        '直せる人がいない（社内にも保守会社にも）',
        'Nobody, neither in-house nor at a maintenance company'
      ),
      unknown,
    ]
  ),
  single(
    'support_end',
    text(
      'サーバー（機械）やOS・製品の保守期限、またはリース満了は？',
      'When does support for the server, OS or product, or the lease, end?'
    ),
    [
      option(
        'passed',
        'すでに過ぎている（延長保守・再リース中）',
        'Already ended (extended support or re-lease)'
      ),
      option('within_1y', '1年以内', 'Within a year'),
      option('1_3y', '1〜3年以内', 'In 1-3 years'),
      option('beyond_3y', '3年以上先', 'In more than 3 years'),
      option(
        'no_hardware',
        '自社で機械を持っていない（クラウドやデータセンターのサービスを利用）',
        'We do not own the machine (cloud or data center service)'
      ),
      unknown,
    ],
    {
      description: text(
        '早いほうでお答えください。保守会社からの案内やリース契約書で確認できます。',
        'Answer for whichever comes first. Notices from the maintenance company or the lease contract will tell you.'
      ),
    }
  ),
  single(
    'integrations',
    text(
      '他のシステムや取引先とのデータのやり取りは、いくつありますか？',
      'How many data exchanges with other systems and business partners are there?'
    ),
    [
      option('few', 'ほとんどない（0〜2）', 'Hardly any (0-2)'),
      option('some', 'いくつかある（3〜9）', 'Some (3-9)'),
      option(
        'many',
        '多い（10以上、または多くの取引先とEDI）',
        'Many (10 or more, or EDI with many partners)'
      ),
      unknown,
    ],
    {
      description: text(
        '例：取引先との受発注データ（EDI）や、会計ソフト・倉庫システム・Webサイトとのデータの受け渡し。おおよそで構いません。',
        'For example order data with partners (EDI), or data passed to accounting, warehouse or Web systems. A rough figure is fine.'
      ),
    }
  ),
  single(
    'source_docs',
    text(
      'プログラムの元（ソースコード）と仕様書は手元にありますか？',
      'Do you have the source code and the specifications?'
    ),
    [
      option(
        'complete',
        'ソースはそろっていて、仕様書もおおむね最新',
        'All source code, and specifications that are mostly up to date'
      ),
      option(
        'no_docs',
        'ソースはそろっているが、仕様書は古い・ほとんどない',
        'All source code, but the specifications are outdated or missing'
      ),
      option(
        'source_missing',
        'ソースが一部見当たらない、または本番で動いているものと同じか自信がない',
        'Some source code is missing, or may not match what runs in production'
      ),
      option(
        'vendor_held',
        'ソースは保守会社や製品の提供元が持っている（自社では出せない）',
        'The maintenance company or the vendor holds the source code'
      ),
      unknown,
    ],
    {
      description: text(
        'ソースコードはプログラムの元になるファイル、仕様書は何をどう処理するかを書いた資料です。',
        'Source code is the files programs are built from; specifications describe what the system does.'
      ),
    }
  ),
  multiple(
    'business_areas',
    text('このシステムで動いている業務は？', 'Which business areas run on this system?'),
    [
      option('sales', '販売・受発注', 'Sales and orders'),
      option('purchasing', '購買・仕入', 'Purchasing'),
      option('inventory', '在庫・倉庫・物流', 'Inventory, warehouse and logistics'),
      option('production', '生産管理', 'Production management'),
      option('accounting', '原価・会計', 'Costing and accounting'),
      option('hr', '人事・給与', 'HR and payroll'),
      option('other', 'その他', 'Other'),
      unknown,
    ],
    ['unknown'],
    {
      ...detail,
      description: text(
        'プログラムの本数がわからない場合の、規模の目安にします。',
        'Used to estimate the size when the number of programs is unknown.'
      ),
    }
  ),
  single(
    'legacy_edi',
    text(
      '電話回線（INSネット）を使う古いEDI（JCA手順・全銀手順など）が残っていますか？',
      'Is any old EDI over phone lines (INS Net, JCA or Zengin protocols) still in use?'
    ),
    [
      option('yes', '残っている', 'Yes'),
      option('no', '残っていない', 'No'),
      option('no_edi', 'EDIはしていない', 'We do not use EDI'),
      unknown,
    ],
    {
      ...detail,
      description: text(
        'NTT東日本・西日本は、INSネットの提供を2028年12月31日で終えると発表しています。',
        'NTT East and West have announced that INS Net will end on December 31, 2028.'
      ),
    }
  ),

  // ── AS/400 (IBM i) (reviewed by an AS/400 migration specialist, 2026-10-11) ────
  multiple(
    'as400_languages',
    text('どんな言語・方法で作られていますか？', 'Which languages or tools was it built with?'),
    [
      option('rpg3', 'RPG III（RPG/400）・RPG II', 'RPG III (RPG/400) / RPG II'),
      option('rpg4', 'RPG IV（ILE RPG）', 'RPG IV (ILE RPG)'),
      option('cobol', 'COBOL', 'COBOL'),
      option(
        'tool',
        '開発ツールで作った',
        'Built with a development tool',
        text('Synon/2E（CA 2E）・LANSAなど', 'Synon/2E (CA 2E), LANSA and similar')
      ),
      option(
        'package',
        'パッケージ製品を使っている',
        'A packaged product',
        text('自社向けに改修した部分を含みます', 'Including changes made for your company')
      ),
      option('other', 'その他（Java・Delphi/400など）', 'Other (Java, Delphi/400 and so on)'),
      unknown,
    ],
    ['unknown'],
    {
      description: text(
        '保守会社の見積書や資産一覧に「RPG」「COBOL」などと書かれています。',
        'Quotes and asset lists from the maintenance company mention "RPG", "COBOL" and so on.'
      ),
    }
  ),
  single(
    'as400_programs',
    text('プログラムはおよそ何本ありますか？', 'Roughly how many programs are there?'),
    [
      option('lt500', '500本未満', 'Fewer than 500'),
      option('500_1999', '500〜1,999本', '500-1,999'),
      option('2000_4999', '2,000〜4,999本', '2,000-4,999'),
      option('gte5000', '5,000本以上', '5,000 or more'),
      unknown,
    ],
    {
      description: text(
        'CLを含めた合計で、おおよそで構いません。保守会社の資産一覧や保守契約の明細に載っていることが多いです。',
        'Including CL; a rough figure is fine. It is often in the asset list or the maintenance contract.'
      ),
    }
  ),
  single(
    'as400_screens_forms',
    text(
      '黒い画面（5250画面）と印刷物（伝票・帳票）は、合わせて何種類くらいありますか？',
      'How many 5250 screens and printed forms are there in total?'
    ),
    [
      option('lt300', '300未満', 'Fewer than 300'),
      option('300_999', '300〜999', '300-999'),
      option('gte1000', '1,000以上', '1,000 or more'),
      unknown,
    ],
    { ...detail, description: roughly }
  ),
  multiple(
    'as400_devices',
    text(
      'AS/400からの印刷や、つながっている機器で当てはまるものは？',
      'Which printing and connected devices apply?'
    ),
    [
      option(
        'special_paper',
        '専用用紙・複写伝票への印刷（ドットプリンターなど）',
        'Printing on pre-printed or carbon-copy forms (dot-matrix printers)'
      ),
      option('labels', 'ラベル・バーコードの印刷', 'Label and barcode printing'),
      option(
        'handheld',
        'ハンディターミナル・倉庫や工場の端末',
        'Handheld terminals, warehouse or factory terminals'
      ),
      option('none', '特にない', 'None'),
      unknown,
    ],
    ['none', 'unknown'],
    detail
  ),
  single(
    'as400_query',
    text(
      '現場の人が自分でAS/400のデータを取り出して使っていますか？',
      'Do staff pull data out of the AS/400 themselves?'
    ),
    [
      option('few', 'ほとんどない', 'Hardly ever'),
      option('some', '一部の部署で使っている', 'Some departments do'),
      option('many', '多くの部署で日常的に使っている', 'Many departments do every day'),
      unknown,
    ],
    {
      ...detail,
      description: text(
        '例：Query（AS/400付属の簡易検索ツール）や、Excelへのデータ転送',
        'For example Query (the built-in query tool) or data transfer to Excel'
      ),
    }
  ),
  single(
    'gaiji',
    text(
      '外字（システムに独自に登録した漢字）を使っていますか？',
      'Do you use custom characters (gaiji) registered in the system?'
    ),
    [
      option('none', '使っていない', 'No'),
      option('few', '少し使っている', 'A few'),
      option('many', '多く使っている（顧客名・地名など）', 'Many (customer and place names)'),
      unknown,
    ],
    {
      ...detail,
      description: text(
        '人名・地名の旧字体など。',
        'Such as old forms of names of people and places.'
      ),
    }
  ),
  single(
    'as400_version',
    text(
      'IBM i（旧OS/400・i5/OS）のバージョンは？',
      'Which IBM i (formerly OS/400, i5/OS) version do you run?'
    ),
    [
      option(
        'v75_76',
        '7.5・7.6',
        '7.5 / 7.6',
        text('IBMの標準サポート中', 'Under IBM standard support')
      ),
      option(
        'v73_74',
        '7.3・7.4',
        '7.3 / 7.4',
        text(
          '標準サポートは終了し、有償の延長サポートのみ',
          'Standard support has ended; paid extended support only'
        )
      ),
      option(
        'le72',
        '7.2以前',
        '7.2 or earlier',
        text('V5R4・6.1・7.1なども含みます', 'Including V5R4, 6.1 and 7.1')
      ),
      unknown,
    ],
    {
      ...detail,
      description: text(
        '保守会社からの案内で確認できます。',
        'Your maintenance company can tell you.'
      ),
    }
  ),

  // ── NEC ACOS (reviewed by an ACOS migration specialist, 2026-10-11) ────────────
  single(
    'acos_series',
    text('お使いのACOSの種類は？', 'Which ACOS do you use?'),
    [
      option(
        'acos2',
        'ACOS-2',
        'ACOS-2',
        text('小型機。i‑PX7300など', 'Small systems such as i‑PX7300')
      ),
      option(
        'acos4',
        'ACOS-4',
        'ACOS-4',
        text(
          '中・大型機。i‑PX9800・i‑PX AKATSUKIなど',
          'Mid-size and large systems such as i-PX9800 and i-PX AKATSUKI'
        )
      ),
      unknown,
    ],
    {
      description: text(
        'リース契約書や保守契約書の機種名でわかります。',
        'The model name on the lease or maintenance contract tells you.'
      ),
    }
  ),
  single(
    'acos_programs',
    text('プログラムはおよそ何本ありますか？', 'Roughly how many programs are there?'),
    [
      option('lt1000', '1,000本未満', 'Fewer than 1,000'),
      option('1000_2999', '1,000〜2,999本', '1,000-2,999'),
      option('3000_9999', '3,000〜9,999本', '3,000-9,999'),
      option('gte10000', '10,000本以上', '10,000 or more'),
      unknown,
    ],
    {
      description: text(
        '画面の処理・夜間の処理・共通部品の合計で、おおよそで構いません。保守会社の資産一覧に載っていることが多い数字です。',
        'Screens, overnight jobs and shared parts together; a rough figure is fine. It is often in the asset list from the maintenance company.'
      ),
    }
  ),
  multiple(
    'acos_languages',
    text(
      'COBOL以外で作られた部分はありますか？',
      'Is any part written in something other than COBOL?'
    ),
    [
      option('cobol_only', 'ほぼCOBOLだけ', 'Almost all COBOL'),
      option('assembler', 'アセンブラ', 'Assembler'),
      option('simple', '簡易言語（IDL・IDLⅡなど）', 'Simple languages (IDL, IDL II and so on)'),
      option('other', 'C・その他', 'C or other'),
      unknown,
    ],
    ['cobol_only', 'unknown']
  ),
  multiple(
    'acos_integrations',
    text(
      '他のシステムや取引先と、どんなデータのやり取りがありますか？',
      'Which data exchanges with other systems and partners are there?'
    ),
    [
      option(
        'internal',
        '社内の他のシステム（工場・倉庫・会計など）',
        'Other systems in-house (factory, warehouse, accounting)'
      ),
      option('edi', '取引先との受発注データ（EDI）', 'Order data with business partners (EDI)'),
      option(
        'legacy_edi',
        '電話回線（INSネット）を使う古いEDI（JCA手順・全銀手順など）が残っている',
        'Old EDI over phone lines (INS Net, JCA or Zengin protocols) is still in use',
        text(
          'NTT東日本・西日本は、INSネットの提供を2028年12月31日で終えると発表しています',
          'NTT East and West have announced that INS Net will end on December 31, 2028'
        )
      ),
      option('web', '銀行・Web受注・EC・POSなど', 'Banks, Web orders, e-commerce, POS'),
      option('few', 'ほとんどない', 'Hardly any'),
      unknown,
    ],
    ['few', 'unknown'],
    detail
  ),
  single(
    'acos_screens_forms',
    text(
      '業務画面（ETOSなどで開く画面）と帳票（伝票・請求書・一覧表など）は、合わせていくつくらいありますか？',
      'How many business screens (opened with ETOS and so on) and printed forms are there in total?'
    ),
    [
      option('lt300', '300未満', 'Fewer than 300'),
      option('300_999', '300〜999', '300-999'),
      option('1000_2999', '1,000〜2,999', '1,000-2,999'),
      option('gte3000', '3,000以上', '3,000 or more'),
      unknown,
    ],
    { ...detail, description: roughly }
  ),
  single(
    'acos_jobs',
    text(
      '夜間や月末に自動で動く処理（ジョブ）は、いくつくらいありますか？',
      'How many jobs run automatically overnight or at month end?'
    ),
    [
      option('lt300', '300未満', 'Fewer than 300'),
      option('300_999', '300〜999', '300-999'),
      option('1000_2999', '1,000〜2,999', '1,000-2,999'),
      option('gte3000', '3,000以上', '3,000 or more'),
      unknown,
    ],
    {
      ...detail,
      description: text(
        'どの処理をどの順で動かすかは、JCLという手順書に書かれています。おおよそで構いません。',
        'The order of the jobs is written in JCL. A rough figure is fine.'
      ),
    }
  ),
  multiple(
    'acos_database',
    text('データはどのように持っていますか？', 'How is the data stored?'),
    [
      option('adbs', 'ADBS（ACOS-4の古い型のデータベース）', 'ADBS (the older ACOS-4 database)'),
      option(
        'riqs',
        'RIQSⅡ（表の形でデータを持つデータベース）',
        'RIQS II (a relational database)'
      ),
      option(
        'files',
        'データベースを使わず、ファイルに保存（VSAS・標準ファイル）',
        'Files without a database (VSAS, standard files)'
      ),
      unknown,
    ],
    ['unknown'],
    detail
  ),
  single(
    'acos_vendor',
    text('保守を委託している会社は？', 'Which company maintains the system?'),
    [
      option('nec', 'NEC（グループ会社を含む）', 'NEC (including group companies)'),
      option('other', 'NEC以外の会社', 'A company other than NEC'),
      option('none', '委託していない', 'No outside company'),
      unknown,
    ],
    detail
  ),

  // ── Microsoft Access (reviewed by an Access migration specialist, 2026-10-11) ──
  single(
    'access_tools',
    text(
      '移行を考えているAccessのツール（業務）はいくつありますか？',
      'How many Access tools (business uses) do you want to migrate?'
    ),
    [
      option('1', '1つ', 'One'),
      option('2_5', '2〜5', '2-5'),
      option('6_20', '6〜20', '6-20'),
      option('21_50', '21〜50', '21-50'),
      option('gte51', '51以上', '51 or more'),
      unknown,
    ],
    {
      description: text(
        '同じツールを各自のPCにコピーしている場合や、画面用とデータ用にファイルを分けている場合は、まとめて1つと数えてください。',
        'Count copies on each PC and front-end / back-end files of the same tool as one.'
      ),
    }
  ),
  single(
    'access_screens_forms',
    text(
      '画面と帳票は、あわせていくつくらいありますか？',
      'How many screens and printed reports are there in total?'
    ),
    [
      option('lt20', '20未満', 'Fewer than 20'),
      option('20_50', '20〜50', '20-50'),
      option('51_100', '51〜100', '51-100'),
      option('gte101', '101以上', '101 or more'),
      unknown,
    ],
    {
      description: text(
        '画面＝メニュー・入力・一覧・検索など。帳票＝伝票・一覧表・ラベルなど、印刷やPDFにするもの。ツールが複数ある場合は、いちばん大きいツールで。おおよそで構いません。',
        'Screens are menus, entry, lists and searches; reports are slips, lists and labels you print or save as PDF. For several tools, answer for the largest. A rough figure is fine.'
      ),
    }
  ),
  multiple(
    'access_features',
    text(
      'このツールで当てはまるものを、すべて選んでください',
      'Choose everything that applies to the tool'
    ),
    [
      option(
        'vba',
        'ボタン一つで、集計・更新・印刷などがまとめて動く',
        'One button runs totals, updates or printing',
        text('VBA・マクロで自動化しているもの', 'Automation with VBA or macros')
      ),
      option(
        'excel',
        'ExcelやCSVの取り込み・出力をしている',
        'Imports or exports Excel / CSV',
        text(
          'Excelのひな形に書き出す帳票を含みます',
          'Including reports written into Excel templates'
        )
      ),
      option(
        'external_data',
        '基幹システムやSQL Serverなど、Accessの外にあるデータを直接読み書きしている',
        'Reads or writes data outside Access, such as the core system or SQL Server'
      ),
      option(
        'other_apps',
        'メール送信（Outlook）やWord・PDFの作成など、ほかのソフトを動かしている',
        'Drives other software, such as sending mail with Outlook or creating Word / PDF files'
      ),
      option(
        'devices',
        '専用の部品や機器を使っている',
        'Uses special components or devices',
        text(
          'カレンダー入力の部品、バーコード、ラベルプリンタ、ハンディ端末など',
          'Calendar controls, barcodes, label printers, handheld terminals'
        )
      ),
      option(
        'none',
        'どれも当てはまらない（入力・検索・印刷が中心）',
        'None of these (mainly entry, search and printing)'
      ),
      option(
        'unknown',
        'わからない',
        "I don't know",
        text('わかる範囲で選んだものと一緒に選べます', 'Can be combined with what you know')
      ),
    ],
    ['none']
  ),
  single(
    'access_maintainer',
    text('このツールを直せる（変更できる）人は？', 'Who can change the tool?'),
    [
      option('team', '社内の複数人が直せる', 'Several people in-house'),
      option(
        'one',
        '社内の1人だけが直せる（作った人・引き継いだ人）',
        'Only one person in-house (the author or a successor)'
      ),
      option(
        'nobody',
        '直せる人がいない（作った人の異動・退職など）',
        'Nobody (the author moved or left)'
      ),
      option('vendor', '社外の会社に頼んでいる', 'An outside company'),
      option(
        'individual',
        '社外の個人（元社員など）に頼んでいる',
        'An individual outside the company (such as a former employee)'
      ),
      unknown,
    ],
    {
      description: text(
        'ツールが複数ある場合は、主なツールでお答えください。',
        'For several tools, answer for the main one.'
      ),
    }
  ),
  multiple(
    'access_version',
    text('お使いのAccess（Office）は？', 'Which Access (Office) do you use?'),
    [
      option('m365', 'Microsoft 365（月額・年額契約）', 'Microsoft 365 (subscription)'),
      option('v2024', '2024（Office LTSC 2024を含む）', '2024 (including Office LTSC 2024)'),
      option('v2021', '2021（Office LTSC 2021を含む）', '2021 (including Office LTSC 2021)'),
      option('v2016_2019', '2016・2019', '2016 / 2019'),
      option('le2013', '2013以前', '2013 or earlier'),
      unknown,
    ],
    ['unknown'],
    {
      description: text(
        '部署やPCごとに違う場合は、すべて選んでください。Accessを開き、［ファイル］→［アカウント］の「製品情報」に表示される名前で確認できます。',
        'If it differs between departments or PCs, choose all. Open Access and look under File > Account > Product Information.'
      ),
    }
  ),
  single(
    'access_location',
    text('Accessのデータはどこに置いていますか？', 'Where is the Access data stored?'),
    [
      option(
        'shared_folder',
        '社内の共有フォルダ（ファイルサーバー・NAS、Zドライブなど）',
        'A shared folder in the office (file server, NAS, a network drive)'
      ),
      option('local_pc', '各自のPCの中', "On each person's PC"),
      option(
        'cloud',
        'OneDrive・SharePoint・Teams・Boxなどのクラウド',
        'Cloud storage such as OneDrive, SharePoint, Teams or Box'
      ),
      option(
        'database',
        'SQL Serverなどのデータベース（Accessは画面だけ）',
        'A database such as SQL Server (Access is only the screens)'
      ),
      unknown,
    ],
    detail
  ),
  single(
    'access_users',
    text('ふだん使っている人は何人くらいですか？', 'How many people use it regularly?'),
    [
      option('1_2', '1〜2人', '1-2'),
      option('3_10', '3〜10人', '3-10'),
      option('11_30', '11〜30人', '11-30'),
      option('gte31', '31人以上', '31 or more'),
      unknown,
    ],
    {
      ...detail,
      description: text('同時でなくて構いません。', 'Not necessarily at the same time.'),
    }
  ),
  single(
    'access_importance',
    text(
      'このツールが止まったら、どのくらい影響しますか？',
      'How much would it matter if the tool stopped?'
    ),
    [
      option(
        'support',
        '部署内の補助的な業務',
        'A supporting task in the department',
        text('数日なら手作業やExcelでしのげる', 'Manual work or Excel would do for a few days')
      ),
      option(
        'main',
        '部署の主要な業務',
        'A main task of the department',
        text('その日の仕事が止まる', "The day's work stops")
      ),
      option(
        'company',
        '全社・取引先・お客様に影響する',
        'The whole company, partners or customers',
        text('受注・出荷・請求・品質記録など', 'Orders, shipping, billing, quality records')
      ),
      unknown,
    ],
    detail
  ),
  single(
    'access_vba_amount',
    text(
      'VBA（Accessに組み込まれたプログラム）はどのくらいありますか？',
      'How much VBA (programs built into Access) is there?'
    ),
    [
      option('few', 'ほとんどない', 'Hardly any'),
      option('light', 'ボタンの動きや入力チェック程度', 'Button actions and input checks'),
      option(
        'heavy',
        '計算・判定・データ更新など、業務のルールが多く書かれている',
        'Many business rules: calculations, decisions, data updates'
      ),
      unknown,
    ],
    detail
  ),
  single(
    'access_sources',
    text(
      '元のファイルや資料は残っていますか？',
      'Are the original files and documents still there?'
    ),
    [
      option(
        'complete',
        '元のファイルも説明資料（仕様書・マニュアル）もある',
        'Both the original files and the documents'
      ),
      option(
        'no_docs',
        '元のファイルはあるが、資料はない・古い',
        'The original files, but documents are missing or outdated'
      ),
      option(
        'compiled',
        '中身を直せない形式（.accde・.mde）しかない、またはパスワードが分からず開けない部分がある',
        'Only compiled files (.accde / .mde), or parts locked by an unknown password'
      ),
      unknown,
    ],
    detail
  ),
  single(
    'access_size',
    text('データが入ったファイルの容量は？', 'How large is the data file?'),
    [
      option('lt1gb', '1GB未満', 'Under 1 GB'),
      option('gte1gb', '1GB以上（上限の2GBに近い）', '1 GB or more (close to the 2 GB limit)'),
      option(
        'split',
        '上限を避けるため、年度ごとなどにファイルを分けている',
        'Split by year or similar to stay under the limit'
      ),
      unknown,
    ],
    {
      ...detail,
      description: text(
        'いちばん大きいファイルで。ファイルを右クリック →［プロパティ］で確認できます。',
        'For the largest file. Right-click the file and choose Properties.'
      ),
    }
  ),
  // What kind of data the tool holds, to plan how the data is handled in the migration
  // (contracts, masking, permissions and records). Not scored (#826)
  multiple(
    'access_data_kinds',
    text(
      'このツールのデータに入っているものを、すべて選んでください',
      'Choose everything the data in the tool contains'
    ),
    [
      option(
        'customer',
        'お客様や取引先の担当者の個人情報',
        'Personal data of customers or contacts at business partners',
        text('氏名・住所・電話番号・メールアドレスなど', 'Names, addresses, phone numbers, email')
      ),
      option(
        'employee',
        '社員の個人情報',
        'Personal data of employees',
        text('氏名・連絡先・人事評価・給与など', 'Names, contact details, appraisals, pay')
      ),
      option(
        'sensitive',
        '健康・病歴など、特に配慮が要る個人情報',
        'Personal data that needs special care, such as health or medical history',
        text(
          '健康診断の結果・病歴・障害・犯罪の経歴など（要配慮個人情報）',
          'Health check results, medical history, disabilities, criminal records'
        )
      ),
      option('my_number', 'マイナンバー', 'My Number (individual number)'),
      option('payment', 'クレジットカードの番号や銀行口座', 'Credit card numbers or bank accounts'),
      option(
        'confidential',
        '個人情報ではない社外秘の情報',
        'Confidential business information other than personal data',
        text(
          '取引の単価・契約の内容・図面・製造のノウハウなど',
          'Prices, contract terms, drawings, manufacturing know-how'
        )
      ),
      option(
        'none',
        '個人情報も社外秘の情報も入っていない',
        'Neither personal data nor confidential information'
      ),
      option(
        'unknown',
        'わからない',
        "I don't know",
        text('わかる範囲で選んだものと一緒に選べます', 'Can be combined with what you know')
      ),
    ],
    ['none'],
    {
      ...detail,
      description: text(
        '移行のときのデータの扱い方を決めるために伺います。種類だけをお選びください。ツールが複数ある場合は、すべてのツールについて。',
        'We ask this to plan how the data is handled in the migration. Choose the kinds only. For several tools, answer for all of them.'
      ),
    }
  ),
  multiple(
    'access_challenges',
    text('いま感じている課題は？', 'Which challenges do you face today?'),
    [
      option(
        'people',
        '作った人しか直せない・中身がわからない',
        'Only the author can change it, or nobody knows how it works'
      ),
      option(
        'manual',
        '転記や二重入力など、手作業に人手がかかる',
        'Manual transcription and double entry take effort'
      ),
      option(
        'stability',
        '同時に使えない・遅い・ファイルが壊れることがある',
        'Cannot be shared at the same time, is slow or files get corrupted'
      ),
      option('remote', '在宅やほかの拠点から使えない', 'Cannot be used from home or other sites'),
      option(
        'data',
        '部署ごとにデータが分かれ、全社で集計・活用できない',
        'Data is split by department and cannot be used company-wide'
      ),
      // Reworded for #303 (the value is kept, so stored answers read the same way): the Office
      // support end itself is asked by access_version
      option(
        'support',
        'Microsoft 365・64bit 化・PC の入れ替えで動かない（動かなくなりそう）',
        'It does not work (or may stop working) after moving to Microsoft 365, 64-bit or a new PC'
      ),
      option(
        'audit',
        '誰が見た・変えたかの記録や、権限の管理を求められている',
        'We are asked to keep records of who saw or changed what, and to manage permissions'
      ),
      option('none', '特にない', 'None in particular'),
    ],
    ['none']
  ),

  // ── Other / not sure ──────────────────────────────────────────────────────────
  single('other_system', text('どんなシステムですか？', 'What kind of system is it?'), [
    option(
      'vb',
      'Visual Basicで作ったクライアントサーバー型システム',
      'Visual Basic client-server system'
    ),
    option('webperformer', 'WebPerformer', 'WebPerformer'),
    option('other_low_code', 'その他のローコード製品', 'Another low-code product'),
    option(
      'office_computer',
      '他社のオフコン（富士通・日立など）',
      'Another office computer (Fujitsu, Hitachi and others)'
    ),
    option('mainframe', '汎用機（メインフレーム）', 'Mainframe'),
    option('package', 'パッケージ製品', 'Packaged software'),
    unknown,
  ]),
  single(
    'other_programs',
    text('プログラム（画面）の本数は？', 'How many programs (screens) are there?'),
    [
      option('lt300', '300未満', 'Fewer than 300'),
      option('300_999', '300〜999', '300-999'),
      option('gte1000', '1,000以上', '1,000 or more'),
      unknown,
    ],
    { description: roughly }
  ),

  // ── Challenges, timing and the respondent (all paths) ─────────────────────────
  multiple(
    'challenges',
    text('いま感じている課題は？', 'Which challenges do you face today?'),
    [
      option(
        'people',
        '扱える人が減っている・退職が近い',
        'Fewer people can handle it, or they will retire soon'
      ),
      option(
        'blackbox',
        '仕様がわからず、直すのも移すのも不安',
        'Nobody knows how it works, so changing or moving it feels risky'
      ),
      option(
        'cost',
        '保守・延命の費用がかさみ、新しい投資に回せない',
        'Maintenance costs leave no budget for new investment'
      ),
      option(
        'deadline',
        'サーバー・OS・ソフトの保守期限が迫っている',
        'Support for the server, OS or software is ending soon'
      ),
      option(
        'agility',
        '取引先の要望や制度の変更への対応、機能の追加に時間がかかる',
        'Requests from partners, rule changes and new features take a long time'
      ),
      option(
        'data',
        'データを経営判断にすぐ使えない',
        'The data cannot be used for management decisions right away'
      ),
      option(
        'remote',
        '社外やスマホ、テレワークから使えない',
        'Cannot be used from outside the office, on phones or when working remotely'
      ),
      option('none', '特にない', 'None in particular'),
    ],
    ['none']
  ),
  single(
    'timeline',
    text(
      '新しいシステムへの切り替えを目指す時期は？',
      'When would you like to switch to a new system?'
    ),
    [
      option('within_1y', '1年以内', 'Within a year'),
      option('1_2y', '1〜2年以内', 'In 1-2 years'),
      option('2_3y', '2〜3年以内', 'In 2-3 years'),
      option('beyond_3y', '3年以上先', 'In more than 3 years'),
      option('undecided', '未定（情報収集中）', 'Not decided (gathering information)'),
    ]
  ),
  single('industry', text('業種は？', 'Which industry are you in?'), [
    option('manufacturing', '製造業', 'Manufacturing'),
    option(
      'distribution',
      '流通業（卸売・小売・物流）',
      'Distribution (wholesale, retail, logistics)'
    ),
    option('other', 'その他', 'Other'),
  ]),
  single('role', text('あなたの立場に近いものは？', 'Which best describes your role?'), [
    option('executive', '経営層・決裁者', 'Executive / decision maker'),
    option('it_manager', '情報システム部門の責任者', 'IT department head'),
    option('it_staff', '情報システム部門の担当者', 'IT staff'),
    option(
      'business_manager',
      '業務部門の責任者（部長・課長）',
      'Business department head (manager)'
    ),
    option('business_staff', '業務部門の担当者', 'Business department staff'),
    option('other', 'その他', 'Other'),
  ]),

  // ── Company size (optional, #150) ─────────────────────────────────────────────
  single(
    'annual_revenue',
    text('年間の売上高（グループ全体ではなく自社）は？', 'Annual revenue of your company?'),
    sizeOptions('annual_revenue'),
    { ...optional, description: sizeNote }
  ),
  single(
    'employees',
    text('従業員数（正社員・契約社員）は？', 'Number of employees?'),
    sizeOptions('employees'),
    optional
  ),
  single(
    'sites',
    text(
      '拠点（本社・工場・営業所・倉庫など）の数は？',
      'Number of sites (head office, plants, sales offices, warehouses)?'
    ),
    sizeOptions('sites'),
    optional
  ),
];

const onPath = (...platforms: AxPlatform[]) => ({ questionId: 'platform', anyOf: platforms });

export const axMigrationDefinition: DiagnosticDefinition = {
  key: AX_MIGRATION_DIAGNOSTIC_KEY,
  // 3: company size questions (#150)
  version: 3,
  title: text('AXマイグレーション 移行診断', 'AX Migration check'),
  description: text(
    '移行を検討しているシステムを選んで、選択式の質問に答えると、移行難易度と刷新の緊急度の目安、優先して取り組むべき課題がわかります。',
    'Choose the system you want to migrate and answer multiple-choice questions to see the migration difficulty, the urgency and the challenge to tackle first.'
  ),
  sections: [
    {
      id: 'platform',
      title: text('移行元のシステム', 'System to migrate'),
      questionIds: ['platform'],
    },
    {
      id: 'as400-operation',
      title: text('運用と期限', 'Operation and deadlines'),
      questionIds: ['maintenance', 'support_end', 'integrations', 'legacy_edi'],
      showWhen: onPath('as400'),
    },
    {
      id: 'as400-assets',
      title: text('規模と作り', 'Size and build'),
      questionIds: [
        'as400_programs',
        'as400_languages',
        'source_docs',
        // Follow-ups, easiest for business departments first
        'business_areas',
        'as400_devices',
        'as400_query',
        'as400_screens_forms',
        'as400_version',
        'gaiji',
      ],
      showWhen: onPath('as400'),
    },
    {
      id: 'acos-operation',
      title: text('機種と運用', 'Machine and operation'),
      questionIds: ['acos_series', 'maintenance', 'support_end', 'acos_vendor'],
      showWhen: onPath('acos'),
    },
    {
      id: 'acos-assets',
      title: text('規模と作り', 'Size and build'),
      questionIds: [
        'acos_programs',
        'acos_languages',
        'source_docs',
        // Follow-ups
        'business_areas',
        'acos_integrations',
        'acos_screens_forms',
        'acos_jobs',
        'acos_database',
        'gaiji',
      ],
      showWhen: onPath('acos'),
    },
    {
      id: 'access-operation',
      title: text('体制とバージョン', 'Upkeep and version'),
      questionIds: [
        'access_maintainer',
        'access_version',
        'access_location',
        'access_users',
        'access_importance',
      ],
      showWhen: onPath('access'),
    },
    {
      id: 'access-assets',
      title: text('規模と作り', 'Size and build'),
      questionIds: [
        'access_tools',
        'access_screens_forms',
        'access_features',
        'access_vba_amount',
        'access_sources',
        'access_size',
        'access_data_kinds',
      ],
      showWhen: onPath('access'),
    },
    {
      id: 'other-operation',
      title: text('システムと運用', 'System and operation'),
      questionIds: ['other_system', 'maintenance', 'support_end'],
      showWhen: onPath('other'),
    },
    {
      id: 'other-assets',
      title: text('規模と作り', 'Size and build'),
      questionIds: [
        'other_programs',
        'integrations',
        'source_docs',
        'business_areas',
        'legacy_edi',
      ],
      showWhen: onPath('other'),
    },
    {
      id: 'business',
      title: text('課題と検討状況', 'Challenges and plans'),
      questionIds: ['challenges', 'timeline', 'industry', 'role'],
      showWhen: onPath('as400', 'acos', 'other'),
    },
    {
      // Access tools have their own everyday problems (asked in the department's words)
      id: 'business-access',
      title: text('課題と検討状況', 'Challenges and plans'),
      questionIds: ['access_challenges', 'timeline', 'industry', 'role'],
      showWhen: onPath('access'),
    },
    {
      // Last before the contact details, all optional, so it never blocks the result
      id: 'company',
      title: text('会社の規模（任意）', 'Company size (optional)'),
      questionIds: ['annual_revenue', 'employees', 'sites'],
    },
  ],
  questions,
};
