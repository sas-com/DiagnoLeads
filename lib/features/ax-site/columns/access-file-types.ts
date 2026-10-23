import type { Column } from './types';

/**
 * How to tell whether a file is an Access tool (#367), for readers who may not know Access.
 * Facts from Microsoft's pages (listed in the sources), with the Japanese UI labels of the
 * Windows steps as the Japanese support page writes them. What .mde is rests on the Access 2003
 * document (previous-versions): the notes say so. The "Type" column of the Details view is left
 * out: no Microsoft page for Windows 10 or 11 names it.
 */
export const accessFileTypes: Column = {
  slug: 'access-file-types',
  locale: 'ja',
  title: 'Access のファイルの見分け方と、拡張子の一覧',
  seoTitle: '.accdb とは？Access の拡張子と見分け方',
  description:
    '.accdb とは何か。.mdb との違い、.accde・.accdr・.laccdb は何のファイルかを一覧にし、Windows 11・10 で拡張子を表示する手順と、Excel のマクロ付きファイルなど似たファイルとの見分け方をまとめました。',
  publishedAt: '2026-10-23',
  updatedAt: '2026-10-23',
  related: 'access',
  cta: 'access-diagnosis',
  thumbnail: {
    icon: 'file-search',
    lines: ['Access のファイルの見分け方と、', '拡張子の一覧'],
  },
  blocks: [
    { type: 'h2', id: 'what-is-access', text: 'Access とは' },
    {
      type: 'p',
      content:
        'Access（Microsoft Access）は、Microsoft の、データをためて、探したり集計したりするためのアプリ（データベース）です。Microsoft 365 のプランなどに含まれていることがあり、PC で使います。',
    },
    {
      type: 'p',
      content:
        'Access で作った業務のツールは、多くの場合1つのファイルです。データを入れる表（テーブル）、入力の画面（フォーム）、帳票（レポート）、自動で動かす手順（マクロ）や、VBA で書いたプログラム（モジュール）が、まとめて入っています。',
    },
    {
      type: 'p',
      content:
        '手元のファイルが Access のものかどうかは、ファイル名の最後にある「拡張子」で見分けます。',
    },

    { type: 'h2', id: 'extensions', text: 'Access の拡張子の一覧（.accdb・.mdb・.accde の違い）' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '拡張子は、ファイル名の最後のピリオドの後ろにある英字で、ファイルの種類を表します。たとえば ',
        },
        { type: 'code', text: '受注管理.accdb' },
        { type: 'text', text: ' なら、拡張子は accdb です。' },
      ],
    },
    {
      type: 'p',
      content:
        'エクスプローラーで拡張子が表示されていない場合は、先に、下の「Windows で拡張子を表示させる」の手順で表示させてください。',
    },
    {
      type: 'p',
      content:
        '結論から言うと、.accdb・.mdb・.accde・.mde・.accdr のどれかなら、Access で作ったツールです。.laccdb・.ldb・.accdt は、ツールそのものではありません。',
    },
    {
      type: 'table',
      header: ['拡張子', '何のファイルか', 'できること・注意'],
      rows: [
        [
          '.accdb',
          'Access 2007 以降の形式のデータベース。今の Access の標準の形式',
          'Access で開いて、使うことも、直すこともできる',
        ],
        [
          '.mdb',
          'Access 2007 より前の形式のデータベース',
          '.accdb の形式に変換できる。ただし Access 97 の形式は、今の Access では直接は変換できない',
        ],
        [
          '.accde',
          '.accdb から作る、実行するためのファイル。VBA の元のコードは残っていない',
          '使うことはできるが、画面・帳票の設計やコードは直せない',
        ],
        [
          '.mde',
          '.mdb から作る、.accde と同じ役割の古い形式',
          '.accde と同じく、設計やコードは直せない',
        ],
        [
          '.accdr',
          '使うだけの画面（ランタイム モード）で開くためのファイル。.accdb の拡張子を .accdr に変えて作る',
          '上のメニュー（リボン）や左の一覧（ナビゲーション ウィンドウ）が出ない形で開く。中身を守る仕組みではない',
        ],
        ['.accdt', 'Access のデータベースのテンプレート（ひな形）', '業務のツールそのものではない'],
        [
          '.laccdb／.ldb',
          '「ロックファイル」（今だれが開いているかを記録する、一時的なファイル）。共有で開くと、同じフォルダに同じ名前でできる（.ldb は .mdb 用）',
          'ツールではない。最後の人が閉じると消えるが、残ることもある',
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '.accde・.mde しか見つからない場合は、' },
        {
          type: 'link',
          text: '.accde（.mde）しか残っていないときの記事',
          href: '/ja/ax-migration/column/access-accde-only',
        },
        { type: 'text', text: 'を、ロックファイルについては、' },
        {
          type: 'link',
          text: '共有フォルダの記事',
          href: '/ja/ax-migration/column/access-shared-folder',
        },
        { type: 'text', text: 'をご覧ください。' },
      ],
    },
    {
      type: 'callout',
      content:
        '拡張子を書き換えても、ファイルの形式は変わりません。たとえば .accde の拡張子を .accdb に変えても、元のコードは戻りません。',
    },

    { type: 'h2', id: 'show-extensions', text: 'Windows で拡張子を表示させる' },
    {
      type: 'p',
      content:
        'エクスプローラーで見たときに、ファイル名に拡張子が表示されていないことがあります。その場合は、次の手順で表示させます。',
    },
    { type: 'h3', id: 'windows-11', text: 'Windows 11 の場合' },
    {
      type: 'ol',
      items: [
        'タスク バーの検索ボックスに「エクスプローラー」と入力し、検索結果から［エクスプローラー］を選びます。',
        'エクスプローラーで、［表示］＞［表示］＞［ファイル名拡張子］を選びます。',
      ],
    },
    { type: 'h3', id: 'windows-10', text: 'Windows 10 の場合' },
    {
      type: 'ol',
      items: [
        'タスク バーの検索ボックスに「エクスプローラー」と入力し、検索結果から［エクスプローラー］を選びます。',
        'エクスプローラーの［表示］タブの［表示/非表示］グループで、［ファイル名拡張子］のチェック ボックスをオンにします。',
      ],
    },
    { type: 'p', content: 'これで、ファイル名の後ろに .accdb などが表示されます。' },
    { type: 'h3', id: 'icon', text: 'アイコンは手がかりに' },
    {
      type: 'p',
      content:
        'Windows は、拡張子を見て、ファイルをどのアプリで開くか、どのアイコンで表示するかを決めています。アイコンで見当をつけたら、.accdb と .accde のような違いは、拡張子で確かめます。',
    },

    { type: 'h2', id: 'look-alikes', text: '似たファイルとの見分け方' },
    { type: 'h3', id: 'excel-macro', text: 'Excel のマクロ付きファイル（.xlsm）' },
    {
      type: 'p',
      content:
        '「マクロで動くツール」と聞いていたものが、Access ではなく Excel のファイルのこともあります。.xlsm は Excel 2007 以降の「マクロ有効ブック」、.xls は Excel 2007 より前のブックです。どちらも Excel のファイルで、Access のファイルではありません。',
    },
    { type: 'h3', id: 'linked-sql-server', text: 'データを SQL Server に置いている .accdb' },
    {
      type: 'p',
      content:
        '拡張子が .accdb でも、データがそのファイルに入っていないことがあります。Access は、SQL Server（Microsoft のデータベースのソフト。サーバーで動かす）などのデータベースにある表に「リンク」して使うことができます。この場合、Access のファイルは画面や帳票を受け持ちます。',
    },
    {
      type: 'p',
      content:
        'データは SQL Server の側にあるため、このファイルをコピーしてもデータは含まれません。分からないときは、作った人や社内のシステムの担当者に、データがどこにあるかを確かめます。',
    },
    { type: 'h3', id: 'split', text: '画面とデータの2つのファイルに分けた形' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Access のツールは、画面や帳票を入れたファイル（フロントエンド）と、データだけを入れたファイル（バックエンド）の2つに分けることができます。Microsoft の例では、',
        },
        { type: 'code', text: 'MySolution.accdb' },
        { type: 'text', text: ' を分けると ' },
        { type: 'code', text: 'MySolution_fe.accdb' },
        { type: 'text', text: ' と ' },
        { type: 'code', text: 'MySolution_be.accdb' },
        { type: 'text', text: ' になります。' },
      ],
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Microsoft は、バックエンドを共有フォルダに置き、フロントエンドを一人ひとりの PC に置く形を案内しています。PC にあるファイルと、共有フォルダにあるファイルの両方で、1つのツールです。詳しくは、',
        },
        {
          type: 'link',
          text: '共有フォルダの記事',
          href: '/ja/ax-migration/column/access-shared-folder',
        },
        { type: 'text', text: 'で説明しています。' },
      ],
    },

    { type: 'h2', id: 'next', text: 'Access のファイルだと分かったら' },
    { type: 'h3', id: 'version', text: '版を確かめる' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Access は、版によってサポートの期限が違います。版の確かめ方と、版ごとのサポートの状況は、',
        },
        {
          type: 'link',
          text: 'Access 2016・2019・2021 のサポート終了の記事',
          href: '/ja/ax-migration/column/access-office-support-end',
        },
        { type: 'text', text: 'にまとめています。' },
      ],
    },
    { type: 'h3', id: 'size', text: 'ファイルの大きさを見る' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Access のファイルには、2GB までという上限があります。大きさの確かめ方と、上限に近いときの進め方は、',
        },
        {
          type: 'link',
          text: '2GB の上限の記事',
          href: '/ja/ax-migration/column/access-2gb-limit',
        },
        { type: 'text', text: 'で説明しています。' },
      ],
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、診断で目安を確かめる' },
    {
      type: 'p',
      content:
        'Access のファイルだと分かったら、「無料Web診断（Access版）」で、直す・Web に移す・置き換えるのどれが合いそうかの目安を確かめられます。選択式の質問に答えるだけです。版やファイルの大きさが分からなくても、「わからない」を選んで進められます。',
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

    { type: 'h2', id: 'related', text: 'あわせて読みたい記事' },
    {
      type: 'ul',
      items: [
        [
          {
            type: 'link',
            text: 'Access を直すか、Web に移すか：判断の目安を表で整理する',
            href: '/ja/ax-migration/column/access-fix-or-web',
          },
        ],
        [
          {
            type: 'link',
            text: '共有フォルダの Access を何人かで使うと起きること',
            href: '/ja/ax-migration/column/access-shared-folder',
          },
        ],
        [
          {
            type: 'link',
            text: '.accde（.mde）しか残っていないときにできること',
            href: '/ja/ax-migration/column/access-accde-only',
          },
        ],
      ],
    },

    {
      type: 'sources',
      items: [
        {
          title: 'Microsoft サポート「データベースの基本」',
          href: 'https://support.microsoft.com/ja-jp/office/database-basics-a849ac16-07c7-4a31-9948-3c8c94a7c204',
        },
        {
          title: 'Microsoft サポート「Microsoft 365 のシステム必要条件」',
          href: 'https://support.microsoft.com/ja-jp/accounts-billing/subscriptions/microsoft-365-system-requirements',
        },
        {
          title: 'Microsoft サポート「Windows の一般的なファイル名拡張子」',
          href: 'https://support.microsoft.com/ja-jp/windows/experience/storage-filemanagement/common-file-name-extensions-in-windows',
        },
        {
          title: 'Microsoft サポート「Access アプリケーションを展開する」',
          href: 'https://support.microsoft.com/ja-jp/access/deploy-an-access-application',
        },
        {
          title: 'Microsoft サポート「.accdb ファイル形式にデータベースを変換する」',
          href: 'https://support.microsoft.com/ja-jp/access/convert-a-database-to-the-accdb-file-format',
        },
        {
          title:
            'Microsoft サポート「SQL Server データベースのインポートまたは SQL Server データベースへのリンク」',
          href: 'https://support.microsoft.com/ja-jp/access/import-or-link-to-data-in-an-sql-server-database',
        },
        {
          title: 'Microsoft Learn「アクセス ロック ファイル (laccdb および ldb) の説明」',
          href: 'https://learn.microsoft.com/ja-jp/previous-versions/troubleshoot/microsoft-365/microsoft-365-apps/access/lock-files-introduction',
        },
        {
          title: 'Microsoft Learn「Preparing Your Access 2003 Database for Deployment, Part 2」',
          href: 'https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2003/aa662934(v=office.11)',
        },
      ],
      notes: [
        '.mde とロックファイルについての説明は、Microsoft の古い技術資料によります。',
        'Windows の手順と画面の名前は、Microsoft の日本語のサポートページの表記に合わせています。',
        '（2026年10月時点の情報です）',
      ],
    },
  ],
  trademark:
    'Microsoft、Access、Excel、SQL Server、Windows、Microsoft 365 は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。',
};
