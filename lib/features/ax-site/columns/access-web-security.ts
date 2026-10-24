import type { Column } from './types';

/**
 * What the PHP vulnerabilities of October 2026 (PHP2shell) say about moving an Access tool to the
 * web (#465). Facts from the PHP project's pages and IPA's alert (listed in the sources); the
 * article never says that the web makes a tool safe (#296) and gives no attack figures (#324).
 * The fixed versions are those of the release of 21 October 2026: review them with the next PHP
 * release and before PHP 8.2 reaches its end of support (31 December 2026).
 */
export const accessWebSecurity: Column = {
  slug: 'access-web-security',
  locale: 'ja',
  title: 'Access を Web に移すときの守り方：PHP の脆弱性「PHP2shell」から考える',
  seoTitle: 'Access の Web 化とセキュリティ：PHP2shell から考える守り方',
  description:
    'Access のツールを Web に移すとき、何を決めておけばよいか。2026年10月に公表された PHP の脆弱性（通称 PHP2shell）を例に、何が危ないのかを整理し、外からつながる範囲、誰がどう直し続けるか、ログイン・権限・記録・バックアップ、使い始める前の確認をまとめました。',
  publishedAt: '2026-10-24',
  updatedAt: '2026-10-24',
  related: 'access',
  cta: 'access-diagnosis',
  thumbnail: {
    icon: 'server-cog',
    lines: ['Access を Web に移すときの', '守り方：PHP の脆弱性', '「PHP2shell」から考える'],
  },
  blocks: [
    {
      type: 'p',
      content:
        'PHP の脆弱性の報道を見て、Access のツールを Web に移すのが心配になった方に向けて、何が起きたのかと、Web に移すときに決めておくことを整理します。',
    },

    { type: 'h2', id: 'what-happened', text: '何が起きたのか' },
    {
      type: 'p',
      content:
        '2026年10月21日、PHP の開発元は、PHP 本体の2件の脆弱性（CVE-2026-109618、CVE-2026-109619）を直した版を公開しました。PHP は、Web のシステムを作るときによく使われるプログラムの言語で、サーバーの上で動きます。',
    },
    {
      type: 'p',
      content:
        'どちらも、ログインしていない人から届いたリクエストで、サーバーの上で勝手にプログラムを動かされるおそれがある、重大な脆弱性とされています。2件は、まとめて「PHP2shell」と呼ばれています。',
    },
    {
      type: 'p',
      content:
        '開発元の告知では、構成によっては、作ったシステムのプログラムが動く前の段階で起きうるとされています。そのため、システムの側の作りだけでは防ぎきれず、PHP 本体の更新が対策になります。',
    },

    { type: 'h2', id: 'fix', text: '対策は、PHP 本体の更新' },
    {
      type: 'p',
      content:
        '開発元は、完全な回避策はなく、更新することが唯一の確実な対策だとしています。直った版は次のとおりです（2026年10月21日の公開時点）。',
    },
    {
      type: 'ul',
      items: [
        'PHP 8.5 系は 8.5.12 以降',
        'PHP 8.4 系は 8.4.27 以降',
        'PHP 8.3 系は 8.3.36 以降',
        'PHP 8.2 系は 8.2.35 以降',
      ],
    },
    { type: 'p', content: 'PHP 8.2 は、2026年12月31日で開発元のサポートが終わる予定です。' },
    {
      type: 'p',
      content:
        'PHP 8.1 以前の版は、開発元のサポートが終わっています。今回は例外として、開発元が 7.4・8.0・8.1 向けに最小限の修正を公開したほか、OS などの提供元が修正を出している場合もあります。修正があるかは、サーバーを管理する人に確かめます。IPA（情報処理推進機構）は、修正が提供されない版を使っている場合、サポートされている版への更新か、対策済みの製品・サービスへの移行を検討するよう案内しています。',
    },
    {
      type: 'p',
      content:
        'PHP は、使っている製品やサービスの中で動いていることもあります。IPA は、影響をその製品の開発元やサービスの提供元の情報で確かめるよう案内しています。すぐに更新できない場合は、つながる範囲を絞ること、それが難しければ外からのつながりを断つことやサービスを一時止めることも含めて判断するよう案内しています。',
    },
    {
      type: 'p',
      content:
        'サーバーの PHP を更新するのは、多くの場合、システムを作った会社や、サーバーを管理する人の仕事です。使っている側からは見えにくいところでもあります。',
    },

    { type: 'h2', id: 'exposed', text: '危なさが大きくなるのは、2つが重なったとき' },
    {
      type: 'p',
      content:
        '開発元は、PHP を使うすべての人に、ただちに更新するよう強く勧めています。そのうえで、危なさが特に大きくなるのは、次の2つが重なったサーバーです。',
    },
    {
      type: 'ul',
      items: [
        'インターネットから、誰でもつながる場所に置かれている',
        '弱点が見つかっても、直されない（サポートの終わった版を使っている、更新する人や手順が決まっていない）',
      ],
    },
    {
      type: 'p',
      content: '問題は「Web だから」というより、「外に開いたまま、直されない」状態にあります。',
    },
    { type: 'callout', content: 'Web に移しても、それだけで安全になるわけではありません。' },
    {
      type: 'p',
      content: 'どんな形で作っても、守り方を決めて、弱点が見つかれば直し続けることが要ります。',
    },

    { type: 'h2', id: 'access-too', text: '今の Access にも、同じことが言える' },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: 'サポートの終わった版の Access も、弱点が見つかっても直されません（',
        },
        {
          type: 'link',
          text: 'Access 2016・2019・2021 のサポート終了',
          href: '/ja/ax-migration/column/access-office-support-end',
        },
        {
          type: 'text',
          text: '）。社内のネットワークだけで使っていても、直されない部品が残ることに変わりはありません。',
        },
      ],
    },
    {
      type: 'p',
      content:
        '今のまま使い続けるときも、Web に移すときも、考えることは同じです。外からどこまでつながるか、弱点が見つかったときに誰が直すか、です。',
    },

    { type: 'h2', id: 'decide', text: 'Web に移すときに、決めておく4つのこと' },
    { type: 'p', content: 'Web に移すと決めたら、作り方と一緒に、守り方も決めておきます。' },
    { type: 'h3', id: 'reach', text: '1. 外から、どこまでつながるようにするか' },
    {
      type: 'p',
      content:
        '社内のネットワークや VPN からだけ使う形にすれば、システムそのものは、インターネットから誰でもつながる状態を避けられます。ただし VPN の機器は、インターネットに開いた入口になるので、この機器も更新し続け、ログインには多要素認証を使います。',
    },
    {
      type: 'p',
      content:
        'VPN を使わずに在宅やほかの拠点から使うなら、会社のアカウントでのログイン（シングルサインオン）と多要素認証を済ませないとシステムに届かない入口を、システムの手前に置きます。システムの中のログイン画面だけでは、今回のようにログインより前に起きる弱点は防げません。',
    },
    { type: 'h3', id: 'keep-fixing', text: '2. 弱点が見つかったとき、誰がどう直すか' },
    {
      type: 'ul',
      items: [
        '使っている部品（言語、ライブラリ、OS、VPN などの機器）と、その版を記録しておく',
        '部品ごとにサポートが終わる時期も記録し、その前に新しい版へ移す予定と予算を決めておく',
        'サポートの期間が長く続く部品を選ぶ',
        '脆弱性の情報を見張り、更新するまでの手順と、保守の契約での目安を決めておく',
      ],
    },
    {
      type: 'p',
      content:
        'IPA も、システムの担当者だけでなく、事業の責任者や経営層も含めて、更新や移行と、そのあとの維持管理に必要な人員・予算・保守体制を確保できるかを検討するよう勧めています。',
    },
    { type: 'h3', id: 'limit', text: '3. 入られても、広げない' },
    {
      type: 'ul',
      items: [
        '使う人ごとに、見られる範囲と操作できる範囲を絞る',
        'システムそのものが持つ権限（データベースやサーバーの権限）も、必要な分だけにする',
        '使わない機能は止めておく',
        '記録（ログ）をシステムとは別の場所にも残し、誰が見るかを決めて、いつもと違う動きに気づけるようにする',
        'バックアップを、システムから消したり書き換えたりできない別の場所に取り、戻す手順を確かめておく',
      ],
    },
    { type: 'h3', id: 'check', text: '4. 使い始める前に、確かめる' },
    {
      type: 'p',
      content:
        '使い始める前に、第三者による脆弱性診断を受けると、作った側では気づきにくい弱点が見つかることがあります。分かるのはその時点のことなので、大きく作り変えたときにも受け直し、2. の更新も続けます。',
    },

    { type: 'h2', id: 'three-ways', text: '直す・Web に移す・置き換える、どれでも同じ' },
    {
      type: 'p',
      content:
        '守り方を決める必要があるのは、Web に移すときだけではありません。今の Access を直して使い続けるときも、既製のクラウドサービスに置き換えるときも、外からつながる範囲、誰がどう直し続けるか、ログインのしかたと、権限・記録・バックアップの管理は、同じように決めておきます。置き換えるときは、提供元がどこまで更新を受け持つかを確かめます。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: 'どの進め方が合うかは、ツールの使われ方で変わります。目安は「' },
        {
          type: 'link',
          text: 'Access を直すか、Web に移すか：判断の目安を表で整理する',
          href: '/ja/ax-migration/column/access-fix-or-web',
        },
        { type: 'text', text: '」にまとめています。' },
      ],
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、診断で進め方の目安を確かめる' },
    {
      type: 'p',
      content:
        '当社の「無料Web診断（Access版）」では、選択式の質問に答えると、3つの進め方のどれが合いそうかの目安と、その理由が分かります。この診断は、ツールの使われ方から進め方の目安を出すもので、ツールやサーバーの脆弱性を調べるものではありません。',
    },
    {
      type: 'p',
      content: '守り方は、進め方を決めるときに、ツールの使われ方に合わせて一緒に決めます。',
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
          title:
            'PHP「Security advisory: Critical remote code execution vulnerabilities, update now」（2026年10月21日）',
          href: 'https://www.php.net/archive/2026.php#2026-10-21-5',
        },
        {
          title: 'PHP「Supported Versions」',
          href: 'https://www.php.net/supported-versions.php',
        },
        {
          title:
            'IPA「PHPの脆弱性対策について(CVE-2026-109618、CVE-2026-109619：PHP2shell)」（2026年10月22日）',
          href: 'https://www.ipa.go.jp/security/security-alert/2026/alert20261022.html',
        },
      ],
      notes: [
        '脆弱性の情報は、あとから更新されることがあります。最新の情報は、開発元と IPA のページで確かめてください。',
        '（2026年10月時点の情報です）',
      ],
    },
  ],
};
