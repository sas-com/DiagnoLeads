import type { Column } from './types';

/**
 * What happens when several people use an Access file in a shared folder (#324). Facts from
 * Microsoft's pages (listed in the sources). The lock file page is a retired technical document
 * (previous-versions) with no current replacement: the text and the notes say so.
 */
export const accessSharedFolder: Column = {
  slug: 'access-shared-folder',
  locale: 'ja',
  title: '共有フォルダの Access を何人かで使うと起きること',
  seoTitle: '共有フォルダの Access を複数人で使うと',
  description:
    '共有フォルダに置いた Access を何人かで使うと、ロック、遅さ、ファイルの破損が起きやすくなります。.laccdb ファイルの役割、分割（フロントエンドとバックエンド）、バックアップ、SQL Server や Web に移す目安をまとめました。',
  publishedAt: '2026-10-22',
  updatedAt: '2026-10-22',
  related: 'access',
  cta: 'access-diagnosis',
  thumbnail: {
    icon: 'users',
    lines: ['共有フォルダの Access を', '何人かで使うと起きること'],
  },
  blocks: [
    { type: 'h2', id: 'simplest-way', text: 'いちばん手軽な共有のしかた' },
    {
      type: 'p',
      content:
        'Access のファイルを社内の共有フォルダに置き、みんなで開く。多くの職場で使われている形です。',
    },
    {
      type: 'p',
      content:
        'Microsoft も、この方法は「いちばん簡単で、必要なものが少ない」と案内しています。一方で、何人もが同時にデータを変えるときの信頼性や、使える状態の保ちやすさに限りがある、とも書いています。',
    },
    {
      type: 'p',
      content: 'この記事では、何人かで使うと何が起きるのか、どう備えるのかを順に見ていきます。',
    },

    { type: 'h2', id: 'locks', text: '起きること1：ロックで、待たされる' },
    { type: 'h3', id: 'lock-file', text: '.laccdb というファイル' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '共有フォルダで Access のファイルを開くと、同じフォルダに、同じ名前で拡張子が ',
        },
        { type: 'code', text: '.laccdb' },
        { type: 'text', text: ' のファイルができます（古い .mdb 形式では ' },
        { type: 'code', text: '.ldb' },
        { type: 'text', text: '）。これは「ロックファイル」と呼ばれます。' },
      ],
    },
    {
      type: 'p',
      content:
        'ロックファイルは、どのレコードを誰が編集中かを管理するためのものです。最後の人がファイルを閉じると、自動で消えます。',
    },
    { type: 'p', content: '次のときは、消えずに残ります。' },
    {
      type: 'ul',
      items: ['消す権限（削除の権限）がない人がいる', 'データベースが「壊れている」と記録された'],
    },
    {
      type: 'p',
      content: '壊れたときに残るのは、そのとき誰が使っていたかの情報を残すためです。',
    },
    { type: 'h3', id: 'write-conflict', text: '編集がぶつかると' },
    {
      type: 'p',
      content:
        '同じレコードを2人が同時に編集すると、「書き込みの競合」のメッセージが出ます。自分の変更を保存するか、捨てるかを選ぶことになります。',
    },
    {
      type: 'p',
      content:
        'なお、ロックファイルの中身だけでは、今だれが使っているかは正確には分かりません。閉じた人の記録が、そのまま残ることがあるためです。',
    },
    { type: 'h3', id: 'folder-permissions', text: 'フォルダの権限に注意' },
    {
      type: 'p',
      content:
        '何人かで使うなら、フォルダには読み取り・書き込み・作成の権限が全員に必要です。ロックファイルを作るためです。',
    },

    { type: 'h2', id: 'slow', text: '起きること2：遅くなる' },
    {
      type: 'p',
      content:
        'ファイルを丸ごと共有する形では、画面や帳票などの部品も含めて、ネットワークを通ってやり取りされます。そのため、動きが遅くなりがちです。',
    },

    { type: 'h2', id: 'corruption', text: '起きること3：ファイルが壊れることがある' },
    {
      type: 'p',
      content:
        'Microsoft は、ネットワーク上のファイルを何人かが同時に編集すると、壊れるおそれが少しあると案内しています。長い文章の項目（長いテキスト型）をよく編集する場合や、長く使い続けるほど、おそれは大きくなります。',
    },
    {
      type: 'p',
      content:
        '壊れるのは、データよりも VBA のコードやフォームのことが多いとされています。データが失われるのはまれで、多くはネットワークの切断などで途中になった、1人の最後の変更です。',
    },
    { type: 'p', content: '置き場所にも注意が必要です。' },
    {
      type: 'ul',
      items: [
        'OneDrive や SharePoint のドキュメントライブラリから、Access のファイルを直接開くのは避けるよう案内されています。',
        '拠点をまたぐ回線（WAN）越しに使う形も、遅くなり、壊れるおそれがあるとして避けるよう案内されています。',
      ],
    },

    { type: 'h2', id: 'split', text: '備え1：ファイルを分ける（分割）' },
    { type: 'p', content: 'Access には、ファイルを2つに分ける機能があります。' },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: 'バックエンド' },
          { type: 'text', text: '：データ（テーブル）だけを入れ、共有フォルダに置く' },
        ],
        [
          { type: 'strong', text: 'フロントエンド' },
          { type: 'text', text: '：画面・帳票・クエリなどを入れ、一人ひとりの PC に置く' },
        ],
      ],
    },
    {
      type: 'p',
      content:
        'こうすると、ネットワークを通るのはデータだけになり、多くの場合、動きが速くなります。壊れることがあっても、多くはその人のフロントエンドのコピーで済みます。',
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '分ける前には、必ずバックアップを取ります。バックエンドの場所は、ドライブ文字（Z: など）ではなく、',
        },
        { type: 'code', text: '\\\\サーバー名\\フォルダ名' },
        { type: 'text', text: ' の形（UNC パス）で指定するよう案内されています。' },
      ],
    },

    { type: 'h2', id: 'backup', text: '備え2：バックアップと、最適化・修復' },
    {
      type: 'ul',
      items: [
        'バックアップは、使う人がいない時間に取り、そのコピーが開けるかまで確かめます。',
        'Access の「最適化と修復」は、ファイルを1人だけで開ける状態でないと実行できません。前もって、使う人に知らせておきます。',
        '修復では、壊れたテーブルのデータの一部が切り捨てられることがあります。実行の直前にも、バックアップを取ります。',
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '最適化と修復の詳しい話は、' },
        {
          type: 'link',
          text: '2GB の上限の記事',
          href: '/ja/ax-migration/column/access-2gb-limit',
        },
        { type: 'text', text: 'にまとめています。' },
      ],
    },

    { type: 'h2', id: 'move-data', text: 'データを SQL Server や Web に移す目安' },
    {
      type: 'p',
      content:
        '分割しても、ファイルを共有する仕組みであることは変わりません。次のようなときは、データの置き場所を変えることを考えます。',
    },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: '使う人が多い。' },
          {
            type: 'text',
            text: ' Access が同時に扱えるのは255人までです。Microsoft の古い技術資料では、データの追加や更新が多いなら、ファイル共有の形は25〜50人までにするのがよいとしています。',
          },
        ],
        [
          { type: 'strong', text: '使いながらバックアップを取りたい。' },
          {
            type: 'text',
            text: ' SQL Server などのデータベースでは、使っている最中でもバックアップが取れます。',
          },
        ],
        [
          { type: 'strong', text: '見せる範囲を分けたい。' },
          {
            type: 'text',
            text: ' データベースの多くは、アカウントごとに見られるテーブルを分けられます。',
          },
        ],
        [
          { type: 'strong', text: '在宅やほかの拠点から使いたい。' },
          {
            type: 'text',
            text: ' この場合は、ブラウザで使える Web システムに移す方が合うことが多くなります。',
          },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '当社の診断でも、3人以上で共有フォルダやクラウドに置いて使い、同時に使えない・遅い・壊れることがあるなら、Web に移す目安としています。ほかの目安は、',
        },
        {
          type: 'link',
          text: '直すか Web に移すかの判断表',
          href: '/ja/ax-migration/column/access-fix-or-web',
        },
        { type: 'text', text: 'をご覧ください。' },
      ],
    },
    {
      type: 'callout',
      content:
        'Web に移しても、それだけで安全になるわけではありません。権限・記録・バックアップを、移した先でも管理していく必要があります。',
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、診断で目安を確かめる' },
    {
      type: 'p',
      content:
        '「無料Web診断（Access版）」では、選択式の質問に答えると、直す・Web に移す・置き換えるのどれが合いそうかの目安が分かります。',
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
          title: 'Microsoft サポート「Ways to share an Access desktop database」',
          href: 'https://support.microsoft.com/en-us/access/ways-to-share-an-access-desktop-database',
        },
        {
          title: 'Microsoft Learn「Description of Access lock files (laccdb and ldb)」',
          href: 'https://learn.microsoft.com/en-us/previous-versions/troubleshoot/microsoft-365/microsoft-365-apps/access/lock-files-introduction',
        },
        {
          title: 'Microsoft サポート「Compact and repair a database」',
          href: 'https://support.microsoft.com/en-us/office/compact-and-repair-a-database-6ee60f16-aed0-40ac-bf22-85fa9f4005b2',
        },
        {
          title: 'Microsoft サポート「Split an Access database」',
          href: 'https://support.microsoft.com/en-us/access/split-an-access-database',
        },
        {
          title: 'Microsoft サポート「Deploy an Access application」',
          href: 'https://support.microsoft.com/en-us/access/deploy-an-access-application',
        },
        {
          title: 'Microsoft サポート「Access specifications」',
          href: 'https://support.microsoft.com/en-us/office/access-specifications-0cf3c66f-9cf2-4e32-9568-98c1025bb47c',
        },
      ],
      notes: [
        'ロックファイルの説明と、25〜50人の目安は、Microsoft の古い技術資料（Description of Access lock files）によります。',
        '（2026年10月時点の情報です）',
      ],
    },
  ],
  trademark:
    'Microsoft、Access、SQL Server、OneDrive、SharePoint は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。',
};
