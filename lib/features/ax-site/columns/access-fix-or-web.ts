import type { Column } from './types';

/**
 * Fix, move to the web or replace: the criteria of the Access diagnosis as a table (#324). The
 * file limits come from Microsoft's own pages (listed in the sources); the table is a guide, and
 * the way forward is decided after looking at the tool.
 */
export const accessFixOrWeb: Column = {
  slug: 'access-fix-or-web',
  locale: 'ja',
  title: 'Access を直すか、Web に移すか：判断の目安を表で整理する',
  seoTitle: 'Access を直すか Web に移すか、判断の目安',
  description:
    'Access の業務ツールを直して使い続けるか、Web に移すか、既製サービスに置き換えるか。利用人数、在宅や拠点、記録と権限、データ量、画面の数、VBA、外部とのつながりごとに、判断の目安を表にまとめました。最後は相談で一緒に決めます。',
  publishedAt: '2026-10-22',
  updatedAt: '2026-10-22',
  related: 'access',
  cta: 'access-diagnosis',
  blocks: [
    { type: 'h2', id: 'compare', text: '3つの進め方を、同じ物差しで比べる' },
    {
      type: 'p',
      content: 'Access の業務ツールをこの先どうするか。進め方は、大きく3つあります。',
    },
    {
      type: 'ul',
      items: ['直して使い続ける', 'Web に移す', '既製サービスに置き換える'],
    },
    {
      type: 'p',
      content:
        'どれがよいかは、ツールの使われ方で変わります。この記事では、判断に使う7つの観点ごとに、目安を表にまとめました。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: 'Office のサポート終了がきっかけで考え始めた方は、先に' },
        {
          type: 'link',
          text: 'Access 2016・2019・2021 のサポート終了の記事',
          href: '/ja/ax-migration/column/access-office-support-end',
        },
        { type: 'text', text: 'もご覧ください。' },
      ],
    },

    { type: 'h2', id: 'quick-table', text: '判断の目安（早見表）' },
    {
      type: 'table',
      header: ['観点', '直して使い続ける', 'Web に移す', '既製サービスに置き換える'],
      rows: [
        ['使う人の数', '10人以下', '11人以上', '人数より、業務の中身で決まる'],
        [
          '在宅・ほかの拠点',
          '1つの事務所の中で使う',
          '在宅やほかの拠点から使いたい',
          'サービスが対応していれば使える',
        ],
        [
          '記録と権限',
          '特に求められていない',
          '誰が見た・変えたかの記録や、権限の管理が必要',
          'サービスの機能で足りるかを確かめる',
        ],
        [
          'データの量',
          '1GB 未満で、余裕がある',
          '1GB 以上、または年度ごとなどにファイルを分けている',
          'サービスの上限を確かめる',
        ],
        [
          '画面と帳票の数',
          '数より、直すところがはっきりしているか',
          '多いときは、移す範囲と順番を決める',
          '20 未満',
        ],
        [
          'VBA の量',
          '多くても、直す範囲が分かっていればよい',
          '多いときは、業務のルールを洗い出す',
          'ほとんどない、またはボタンの動きや入力チェック程度',
        ],
        [
          '外部とのつながり',
          'Excel や SQL Server、機器とのつながりを今のまま残したい',
          'つながる先も含めて作り直す',
          'Excel や CSV の取り込み・出力くらい',
        ],
      ],
    },
    {
      type: 'p',
      content: '表は、当社の「無料Web診断（Access版）」の判定の考え方に合わせています。',
    },

    { type: 'h2', id: 'how-to-read', text: '表の読み方' },
    { type: 'h3', id: 'web-criteria', text: 'Web に移す目安は、1つでも当てはまるか' },
    {
      type: 'p',
      content:
        '診断では、まず Web に移す目安を見ます。次のどれか1つでも当てはまれば、Web に移す進め方をおすすめします。',
    },
    {
      type: 'ul',
      items: [
        '使う人が11人以上',
        '止まると、全社・取引先・お客様に影響する',
        '在宅やほかの拠点から使いたい',
        '誰が見た・変えたかの記録や、権限の管理を求められている',
        '3人以上で共有フォルダやクラウドに置いて使い、同時に使えない・遅い・壊れることがある',
        'データのファイルが1GB 以上、または上限を避けるためにファイルを分けている',
        'Access のツールが6つ以上ある',
      ],
    },
    {
      type: 'p',
      content:
        'Access のファイルには、上限があります。Microsoft の仕様では、1つのデータベースの大きさは2GB まで（システムが使う分を除く）、同時に使える人は255人までです。1GB は、この上限に近づいてきた目安として見ています。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '上限についての詳しい話は、' },
        {
          type: 'link',
          text: '2GB の上限に近づいたときの記事',
          href: '/ja/ax-migration/column/access-2gb-limit',
        },
        { type: 'text', text: 'にまとめました。何人かで使うときに起きることは、' },
        {
          type: 'link',
          text: '共有フォルダの記事',
          href: '/ja/ax-migration/column/access-shared-folder',
        },
        { type: 'text', text: 'をご覧ください。' },
      ],
    },
    { type: 'h3', id: 'replace-criteria', text: '置き換えの目安は、3つがそろうか' },
    {
      type: 'p',
      content:
        'Web に移す目安に当てはまらなければ、次に置き換えを考えます。次の3つがそろうと、既製サービスで足りることが多くなります。',
    },
    {
      type: 'ul',
      items: [
        '入力・検索・印刷が中心で、ほかのソフトや機器を動かしていない（Excel や CSV の取り込み・出力はあってもよい）',
        '画面と帳票が、あわせて20 未満',
        '業務のルールが、VBA にたくさん書かれていない',
      ],
    },
    { type: 'h3', id: 'fix-otherwise', text: 'どちらでもなければ、直して使い続ける' },
    {
      type: 'p',
      content:
        'どちらにも当てはまらなければ、今の Access を直して使い続ける進め方が合います。使う人が少なく、つながりや VBA を今のまま生かしたいツールです。',
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '直すときは、版の切り替えに注意してください。Microsoft 365 は、特に選ばなければ 64 ビット版が入ります。64 ビット版では、Windows の機能を呼ぶ VBA の命令（Declare 文）に ',
        },
        { type: 'code', text: 'PtrSafe' },
        {
          type: 'text',
          text: ' という指定がないと、コンパイルの段階でエラーになります。',
        },
      ],
    },

    { type: 'h2', id: 'not-table-alone', text: '表だけで決めない理由' },
    { type: 'p', content: 'この表は、あくまで目安です。次のようなことは、表からは分かりません。' },
    {
      type: 'ul',
      items: [
        '帳票の中に、計算や判定がどれだけ隠れているか',
        '「わからない」と答えた部分に、何が入っているか',
        '中身の分かる人が、社内にいるか',
        [
          { type: 'text', text: '元のファイルが残っているか（' },
          {
            type: 'link',
            text: '.accde しか残っていないとき',
            href: '/ja/ax-migration/column/access-accde-only',
          },
          { type: 'text', text: 'は、進め方が変わります）' },
        ],
      ],
    },
    {
      type: 'p',
      content:
        'そのため、診断の結果は「この進め方が合いそう」という目安にとどめています。進め方は、ツールの中身を確かめたうえで、相談しながら一緒に決めます。',
    },
    {
      type: 'p',
      content:
        '1つに決める必要もありません。よく使う機能から Web に移し、残りは今の Access で使い続ける、という組み合わせもできます。',
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、診断で目安を確かめる' },
    {
      type: 'p',
      content:
        '当社の「無料Web診断（Access版）」では、選択式の質問に答えると、3つの進め方のどれが合いそうかの目安と、その理由が分かります。結果は印刷や PDF で保存できます。',
    },
    {
      type: 'p',
      content: [
        {
          type: 'link',
          text: '無料Web診断（Access版）を見る',
          href: '/ja/ax-migration/access#diagnosis',
        },
      ],
    },
    {
      type: 'p',
      content: 'ご希望の方は、30分のオンライン相談もご利用いただけます。無理な営業はいたしません。',
    },

    {
      type: 'sources',
      items: [
        {
          title: 'Microsoft サポート「Access specifications」',
          href: 'https://support.microsoft.com/en-us/office/access-specifications-0cf3c66f-9cf2-4e32-9568-98c1025bb47c',
        },
        {
          title: 'Microsoft サポート「Choose between the 64-bit or 32-bit version of Office」',
          href: 'https://support.microsoft.com/en-us/office/choose-between-the-64-bit-or-32-bit-version-of-office-2dee7807-8f95-4d0c-b5fe-6c6f49b8d261',
        },
        {
          title:
            'Microsoft Learn「Compatibility between the 32-bit and 64-bit versions of Office」',
          href: 'https://learn.microsoft.com/en-us/office/client-developer/shared/compatibility-between-the-32-bit-and-64-bit-versions-of-office',
        },
      ],
      notes: ['（2026年10月時点の情報です）'],
    },
  ],
  trademark:
    'Microsoft、Access、SQL Server、Excel は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。',
};
