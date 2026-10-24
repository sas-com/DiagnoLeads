import type { Column } from './types';

/**
 * When only the .accde (.mde) file is left (#324). Facts from Microsoft's pages (listed in the
 * sources); what .mde allows rests on the Access 2003 and 2007 documents (previous-versions),
 * which have no current replacement: the text and the notes say so. Nothing is promised about
 * what can be recovered.
 */
export const accessAccdeOnly: Column = {
  slug: 'access-accde-only',
  locale: 'ja',
  title: '.accde（.mde）しか残っていないときにできること',
  seoTitle: '.accde・.mde しか残っていないときは',
  description:
    'Access のツールが .accde（.mde）でしか残っていないとき、何ができて何ができないのか。テーブルのデータは取り出せても、VBA のコードは残っていません。動きから作り直す進め方と、外部に作ってもらったツールで確かめたいことをまとめました。',
  publishedAt: '2026-10-22',
  updatedAt: '2026-10-22',
  related: 'access',
  cta: 'access-diagnosis',
  thumbnail: {
    icon: 'file-lock',
    lines: ['.accde（.mde）しか', '残っていないときにできること'],
  },
  blocks: [
    { type: 'h2', id: 'what-is-accde', text: '.accde と .mde は、「中身を直せない形」のファイル' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Access のツールを配るとき、作った人が ',
        },
        { type: 'code', text: '.accde' },
        {
          type: 'text',
          text: ' という形式で保存することがあります。古い .mdb 形式では、同じ役割のファイルが ',
        },
        { type: 'code', text: '.mde' },
        { type: 'text', text: ' です。' },
      ],
    },
    {
      type: 'p',
      content:
        'この形式で保存すると、VBA のプログラムはコンピューターが実行する形に変換され、人が読める元のコード（ソースコード）は取り除かれます。ツールはそのまま動き、データの入力や帳票の印刷もできます。ただし、中身を直すことはできません。',
    },
    {
      type: 'p',
      content:
        '直すときは、元の .accdb（または .mdb）を直して、もう一度 .accde に保存し直す。Microsoft は、そのために元のファイルを保管しておくよう案内しています。',
    },
    {
      type: 'p',
      content:
        'ところが実際には、元のファイルが見つからず、.accde だけが残っていることがあります。この記事では、その場合に何ができるかを整理します。',
    },

    { type: 'h2', id: 'can-and-cannot', text: 'できること、できないこと' },
    {
      type: 'table',
      header: ['対象', '.accde（.mde）から', '補足'],
      rows: [
        ['テーブル（データ）', '取り出せる', '新しい .accdb に取り込める'],
        ['クエリ・マクロ', '取り出せる', '新しい .accdb に取り込める'],
        ['フォーム・レポートの設計', '取り出せない', '変更も、新しく作ることもできない'],
        ['VBA のコード', '取り出せない', 'ファイルに残っていない'],
        ['参照設定', '変えられない', 'ほかのライブラリへの参照を足したり外したりできない'],
      ],
    },
    {
      type: 'p',
      content:
        'テーブルのデータは、多くの場合取り出せます。一方、画面や帳票の作りと、VBA に書かれた業務のルールは、ファイルからは戻せません。',
    },

    { type: 'h2', id: 'cautions', text: '先に知っておきたい注意点' },
    { type: 'h3', id: 'bitness', text: '32 ビット版と 64 ビット版をまたいで使えない' },
    {
      type: 'p',
      content:
        '32 ビット版の Office で作った .accde（.mde）は、64 ビット版では動きません。逆も同じです。64 ビット版で使うには、元のファイルから作り直す（コンパイルし直す）必要があります。',
    },
    {
      type: 'p',
      content:
        'Microsoft 365 は、特に選ばなければ 64 ビット版が入ります。PC の入れ替えをきっかけに、急に開けなくなることがあるのはこのためです。',
    },
    { type: 'h3', id: 'mde-convert', text: '古い .mde は、新しい版に変換できない' },
    {
      type: 'p',
      content:
        '.mde は、新しい版の Access で変換することができません。Microsoft の Access 2007 の資料では、.mde を新しい形式にするには、元の .mdb を探して変換するよう案内しています。',
    },
    { type: 'h3', id: 'password', text: 'パスワードが設定されていることがある' },
    {
      type: 'p',
      content:
        '暗号化された .accdb から作った .accde は、開くたびにパスワードが必要です。パスワードが分からないと、開くことができません。',
    },

    { type: 'h2', id: 'steps', text: '進め方' },
    { type: 'h3', id: 'find-original', text: '1. 元のファイルを、もう一度探す' },
    {
      type: 'p',
      content: 'まず、元の .accdb（.mdb）がどこかに残っていないかを探します。',
    },
    {
      type: 'ul',
      items: [
        '古いバックアップや、以前のサーバー',
        '作った人が使っていた PC',
        '外部の会社が作った場合は、その会社',
      ],
    },
    {
      type: 'p',
      content: '元のファイルが見つかれば、選べる進め方が大きく広がります。',
    },
    { type: 'h3', id: 'backup', text: '2. 今あるファイルのバックアップを取る' },
    {
      type: 'p',
      content:
        '.accde と、データの入ったファイルをコピーし、そこから開けるかを確かめます。作業はコピーで行います。',
    },
    { type: 'h3', id: 'find-data', text: '3. データの置き場所を確かめる' },
    {
      type: 'p',
      content:
        'Microsoft は、.accde は画面だけを入れたファイル（フロントエンド）に向いていると案内しています。ツールがこの形に分けられていれば、データは別のファイル（バックエンド）に入っています。そのファイルが .accdb のまま残っていれば、テーブルはそちらにあります。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: 'ファイルの分け方については、' },
        {
          type: 'link',
          text: '共有フォルダの記事',
          href: '/ja/ax-migration/column/access-shared-folder',
        },
        { type: 'text', text: 'で説明しています。' },
      ],
    },
    { type: 'h3', id: 'record-behavior', text: '4. 動きを記録する' },
    { type: 'p', content: 'コードが無いなら、ツールの「動き」を手がかりに作り直します。' },
    {
      type: 'ul',
      items: [
        '画面ごとに、何を入力し、どのボタンを押すと何が起きるか',
        '帳票ごとに、どのデータがどう並び、どう合計されるか',
        '実際の出力（帳票の PDF、書き出した Excel など）の見本',
        '使っている人が知っている、例外の扱い',
      ],
    },
    {
      type: 'p',
      content: '実際の出力の見本は、作り直したあとに同じ結果になるかを確かめるときにも使います。',
    },
    { type: 'h3', id: 'contract', text: '5. 外部の会社が作ったツールなら、契約を確かめる' },
    {
      type: 'p',
      content:
        '外部の会社や個人に作ってもらったツールなら、契約書を確かめてください。元のファイルの受け渡しや、作り直してよいかが、どう決められているかを見ます。分からないときは、作った会社に問い合わせます。',
    },

    { type: 'h2', id: 'fix-or-rebuild', text: '直すか、作り直すか' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '元のファイルが見つからない場合、今の .accde を直して使い続けることはできません。進め方は、Web に移すか、既製サービスに置き換えるかのどちらかになることが多くなります。どちらが合うかは、',
        },
        {
          type: 'link',
          text: '直すか Web に移すかの判断表',
          href: '/ja/ax-migration/column/access-fix-or-web',
        },
        { type: 'text', text: 'を参考にしてください。' },
      ],
    },
    {
      type: 'p',
      content:
        'どこまで分かるか、何を作り直すかは、ファイルと使われ方を確かめないと決められません。この記事も、取り出せることをお約束するものではありません。',
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、診断で目安を確かめる' },
    {
      type: 'p',
      content:
        '「無料Web診断（Access版）」には、元のファイルや資料が残っているかを選ぶ質問があります。.accde（.mde）しかない場合も、それを踏まえた目安が分かります。',
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
      content:
        'ご希望の方は、30分の無料オンライン相談もご利用いただけます。無理な営業はいたしません。',
    },

    {
      type: 'sources',
      items: [
        {
          title: 'Microsoft サポート「Hide VBA code from users」',
          href: 'https://support.microsoft.com/en-us/office/hide-vba-code-from-users-ce6ab610-af07-4008-91e0-1ef1b796ff18',
        },
        {
          title: 'Microsoft サポート「Deploy an Access application」',
          href: 'https://support.microsoft.com/en-us/access/deploy-an-access-application',
        },
        {
          title: 'Microsoft Learn「Preparing Your Access 2003 Database for Deployment, Part 2」',
          href: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2003/aa662934(v=office.11)',
        },
        {
          title: 'Microsoft Learn「Migration considerations for Access 2007」',
          href: 'https://learn.microsoft.com/en-us/previous-versions/office/office-2007-resource-kit/cc178973(v=office.12)',
        },
        {
          title: 'Microsoft サポート「Choose between the 64-bit or 32-bit version of Office」',
          href: 'https://support.microsoft.com/en-us/office/choose-between-the-64-bit-or-32-bit-version-of-office-2dee7807-8f95-4d0c-b5fe-6c6f49b8d261',
        },
      ],
      notes: [
        '.mde についての説明は、Microsoft の Access 2003 と Access 2007 の古い技術資料によります。',
        '（2026年10月時点の情報です）',
      ],
    },
  ],
  trademark:
    'Microsoft、Access、Excel は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。',
};
