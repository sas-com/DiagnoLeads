import type { Column } from './types';

/**
 * When an Access file nears the 2 GB limit (#324). Facts and limits from Microsoft's own pages
 * (listed in the sources); moving to the web is never said to make the data safe.
 */
export const access2gbLimit: Column = {
  slug: 'access-2gb-limit',
  locale: 'ja',
  title: 'Access の 2GB の上限に近づいたら',
  seoTitle: 'Access の2GBの上限に近づいたら',
  description:
    'Access のファイルは2GBまでです。上限に近づいたときにできることを、最適化と修復、ファイルの分割、SQL Server へのデータ移行（Express 版の上限）、Web への移行の順に整理しました。それぞれの注意点もまとめています。',
  publishedAt: '2026-10-22',
  updatedAt: '2026-10-22',
  related: 'access',
  cta: 'access-diagnosis',
  thumbnail: {
    icon: 'database',
    lines: ['Access の 2GB の', '上限に近づいたら'],
  },
  blocks: [
    { type: 'h2', id: 'limit', text: 'Access のファイルは、2GB まで' },
    {
      type: 'p',
      content:
        'Access のデータベース（.accdb・.mdb）の大きさには、上限があります。Microsoft の仕様では、テーブルやフォームなどのすべての部品とデータを合わせて、2GB まで（システムが使う分を除く）です。',
    },
    {
      type: 'p',
      content:
        'ふだんは気にならない数字です。ただ、何年も記録をためていくと、近づいてくることがあります。',
    },
    { type: 'h3', id: 'check-size', text: '大きさの確かめ方' },
    {
      type: 'p',
      content:
        'エクスプローラーでファイルを右クリックし、「プロパティ」を開くと、大きさが分かります。データを別のファイルに分けている場合は、データの入ったファイルを見ます。',
    },

    { type: 'h2', id: 'why-large', text: 'まず、ファイルが大きくなる理由を知る' },
    { type: 'p', content: 'ファイルが大きくなるのは、データが増えたからとは限りません。' },
    {
      type: 'ul',
      items: [
        'Access は作業のために、隠れた一時的な部品を作ります。これが、要らなくなったあとも残ることがあります。',
        '部品やデータを消しても、その分の場所は自動では空きません。',
      ],
    },
    {
      type: 'p',
      content: 'そのため、データの量のわりにファイルが大きい、ということが起こります。',
    },

    { type: 'h2', id: 'compact', text: 'できること1：最適化と修復' },
    {
      type: 'p',
      content:
        'Access の「最適化と修復」を実行すると、使われていない場所を取り除いて、ファイルを小さくできます。動きがよくなることもあります。',
    },
    {
      type: 'p',
      content:
        '開いているファイルなら、「ファイル」→「情報」にある、データベースの最適化（圧縮）と修復のボタンから実行できます。',
    },
    { type: 'p', content: '実行の前に、次のことを確かめます。' },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: '直前にバックアップを取る。' },
          {
            type: 'text',
            text: ' 修復では、壊れたテーブルのデータの一部が切り捨てられることがあります。',
          },
        ],
        [
          { type: 'strong', text: '1人だけで開ける状態にする。' },
          {
            type: 'text',
            text: ' 実行には、ファイルを1人で使える状態が必要です。使う人に前もって知らせます。',
          },
        ],
        [
          { type: 'strong', text: '縮むのは「空き」だけ。' },
          { type: 'text', text: ' データそのものを圧縮するわけではありません。' },
        ],
      ],
    },
    {
      type: 'p',
      content:
        '閉じるたびに自動で最適化する設定（「閉じるときに最適化する」）もあります。ただ、何人かで使うファイルでは、一時的に使えなくなることがあるため、避けた方がよい場合があると案内されています。',
    },
    {
      type: 'p',
      content: '最適化しても、データそのものが上限に近いなら、根本の解決にはなりません。',
    },

    { type: 'h2', id: 'split', text: 'できること2：ファイルを分ける' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'Access には、データ（テーブル）だけのファイルと、画面や帳票などのファイルに分ける機能があります（分割）。データだけを1つのファイルにまとめられるので、扱いやすくなります。分割について詳しくは、',
        },
        {
          type: 'link',
          text: '共有フォルダの記事',
          href: '/ja/ax-migration/column/access-shared-folder',
        },
        { type: 'text', text: 'をご覧ください。' },
      ],
    },
    {
      type: 'p',
      content:
        '古い年度のデータを別のファイルに移して、上限を避ける方法もあります。ただ、年度をまたいだ集計や検索がしにくくなります。分けたファイルが増えるほど、管理の手間も増えます。',
    },

    { type: 'h2', id: 'sql-server', text: 'できること3：データを SQL Server に移す' },
    {
      type: 'p',
      content:
        '画面や帳票は Access のまま使い、データだけを SQL Server に移す方法があります。Access からは、リンクテーブルとして SQL Server のデータを読み書きします。',
    },
    {
      type: 'p',
      content:
        'Microsoft は、Access から SQL Server に移す理由として、2GB の上限や、同時に使える人数（255人まで）を挙げています。使っている最中でもバックアップが取れることも、利点として挙げられています。',
    },
    { type: 'p', content: '移すときの主な注意点です。' },
    {
      type: 'ul',
      items: [
        '移す前に、バックアップを取る。',
        'テーブルごとに、主キーを設定しておく。',
        '添付ファイル型の項目があるテーブルは、Microsoft の移行ツール（SSMA）では移せない。',
      ],
    },
    { type: 'h3', id: 'sql-express', text: '無料の SQL Server Express の上限' },
    {
      type: 'p',
      content:
        'SQL Server には、無料で使える Express という版があります。ただし、1つのデータベースの大きさに上限があります。',
    },
    {
      type: 'table',
      header: ['版', '1つのデータベースの上限', 'ほかの主な上限'],
      rows: [
        [
          'SQL Server 2022 Express',
          '10GB',
          'CPU は1ソケットか4コアの少ない方、データ用のメモリーは1,410MB',
        ],
        [
          'SQL Server 2025 Express',
          '50GB',
          'CPU は1ソケットか4コアの少ない方、データ用のメモリーは1,410MB',
        ],
      ],
    },
    {
      type: 'p',
      content: 'データの量や、使う人の数に合わせて、版を選ぶ必要があります。',
    },

    { type: 'h2', id: 'web', text: 'できること4：Web に移す' },
    {
      type: 'p',
      content:
        '在宅やほかの拠点から使いたい、誰が見た・変えたかの記録が必要、という場合は、データの置き場所だけでなく、画面も含めて Web に移す方が合うことがあります。',
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '当社の診断では、データのファイルが1GB 以上、または上限を避けるためにファイルを分けているなら、Web に移す目安としています。ほかの目安は、',
        },
        {
          type: 'link',
          text: '直すか Web に移すかの判断表',
          href: '/ja/ax-migration/column/access-fix-or-web',
        },
        { type: 'text', text: 'にまとめました。' },
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
        '「無料Web診断（Access版）」では、ファイルの大きさや利用人数などを選ぶと、直す・Web に移す・置き換えるのどれが合いそうかの目安が分かります。',
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
          title: 'Microsoft サポート「Compact and repair a database」',
          href: 'https://support.microsoft.com/en-us/office/compact-and-repair-a-database-6ee60f16-aed0-40ac-bf22-85fa9f4005b2',
        },
        {
          title: 'Microsoft サポート「Split an Access database」',
          href: 'https://support.microsoft.com/en-us/access/split-an-access-database',
        },
        {
          title: 'Microsoft サポート「Migrate an Access database to SQL Server」',
          href: 'https://support.microsoft.com/en-us/access/migrate-an-access-database-to-sql-server',
        },
        {
          title: 'Microsoft Learn「Editions and supported features of SQL Server 2022」',
          href: 'https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2022',
        },
        {
          title: 'Microsoft Learn「Editions and supported features of SQL Server 2025」',
          href: 'https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025',
        },
      ],
      notes: ['（2026年10月時点の情報です）'],
    },
  ],
  trademark:
    'Microsoft、Access、SQL Server は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。',
};
