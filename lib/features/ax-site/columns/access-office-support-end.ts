import type { Column } from './types';

/**
 * Access 2016, 2019 and 2021 end of support (#324, #158). Facts from Microsoft's own pages only
 * (listed in the sources); no amounts, cases or attack figures, and moving to the web is never
 * said to make the data safe.
 */
export const accessOfficeSupportEnd: Column = {
  slug: 'access-office-support-end',
  locale: 'ja',
  title: 'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか',
  seoTitle: 'Access 2021などのサポート終了、使い続けるとどうなる？',
  description:
    'Access 2016・2019は2025年10月、Access 2021は2026年10月にサポートが終了しました。使い続けると何が起きるか、版の確かめ方、直す・Web に移す・置き換えるの3つの進め方、今週からできる確認をまとめました。',
  publishedAt: '2026-10-22',
  updatedAt: '2026-10-22',
  related: 'access',
  cta: 'access-diagnosis',
  blocks: [
    { type: 'h2', id: 'support-ended', text: 'Access のサポートが、相次いで終わりました' },
    {
      type: 'p',
      content:
        'Microsoft Access は、Office の一部として提供されています。その Office のサポートが、ここ1年で続けて終わりました。',
    },
    {
      type: 'ul',
      items: [
        'Office 2016 と Office 2019 は、2025年10月14日にサポートが終了しました。',
        'Office 2021 と Office LTSC 2021 は、2026年10月13日にサポートが終了しました。',
      ],
    },
    {
      type: 'p',
      content:
        'どちらにも Access が含まれます。部署で使っている受注管理や台帳などのツールが、これらの版の Access で動いているなら、この記事の対象です。',
    },
    {
      type: 'p',
      content:
        '慌てる必要はありません。ただ、何が変わったのかを知り、次に何をするかを決めておくことは大切です。この記事では、その順番を整理します。',
    },

    { type: 'h2', id: 'versions', text: 'お使いの版と、サポートの状況' },
    {
      type: 'table',
      header: ['版', 'サポート終了日', '状況'],
      rows: [
        ['Access 2016（Office 2016）', '2025年10月14日', '終了'],
        ['Access 2019（Office 2019）', '2025年10月14日', '終了'],
        [
          'Access 2021・Access LTSC 2021（Office 2021・Office LTSC 2021）',
          '2026年10月13日',
          '終了',
        ],
        ['Access LTSC 2024（Office LTSC 2024）', '2029年10月9日', 'サポート中'],
        ['Microsoft 365 の Access', '終了日の定めなし', '更新が続く'],
      ],
    },
    {
      type: 'p',
      content:
        '日付は Microsoft の案内に合わせています。Office 2021 については、期間の延長や、延長のセキュリティ更新は行わないと案内されています。',
    },
    { type: 'h3', id: 'check-version', text: '版の確かめ方' },
    {
      type: 'ol',
      items: [
        'Access を開きます。',
        '「ファイル」から「アカウント」を選びます。',
        '右側の「製品情報」に、製品名が出ます。',
      ],
    },
    {
      type: 'p',
      content:
        'あわせて、同じ画面の「Access のバージョン情報」を押してください。32 ビット版か 64 ビット版かが表示されます。あとで使うので、メモしておきましょう。',
    },

    { type: 'h2', id: 'keep-using', text: '使い続けると、どうなるか' },
    { type: 'h3', id: 'still-runs', text: 'ツールは、そのまま動きます' },
    {
      type: 'p',
      content:
        'サポートが終わっても、Access が急に起動しなくなるわけではありません。Microsoft も、アプリは引き続き動く場合があると案内しています。明日から業務が止まる、という話ではありません。',
    },
    { type: 'h3', id: 'no-fixes', text: '弱点が見つかっても、直されなくなります' },
    {
      type: 'p',
      content:
        '止まるのは、Microsoft からの修正です。新しく見つかった弱点（脆弱性）へのセキュリティ修正、不具合の修正、技術サポートが提供されなくなります。',
    },
    {
      type: 'p',
      content: 'つまり、弱点が見つかっても直らない版で、業務のデータを扱い続けることになります。',
    },
    { type: 'h3', id: 'may-break', text: '周りの更新で、動かなくなることがあります' },
    {
      type: 'p',
      content:
        'Windows や、ほかのアプリは更新が続きます。サポートの終わった版は、その変化に合わせた修正を受けられません。Microsoft は、時間がたつにつれてアプリの性能や品質が落ちるおそれがあると案内しています。',
    },
    {
      type: 'p',
      content:
        'PC の入れ替えや、ほかのソフトの更新をきっかけに、ある日うまく動かなくなる。そうなると、そのツールを使う業務が止まります。',
    },
    { type: 'h3', id: 'data', text: 'データの管理にも、目を向けておきましょう' },
    {
      type: 'p',
      content:
        'Access のツールは、共有フォルダに置かれていることが多くあります。次の点を確かめてください。',
    },
    {
      type: 'ul',
      items: [
        'ファイルのコピーが、個人の PC や USB メモリに散らばっていないか。',
        '誰が見たか、誰が変えたかの記録が残るか。',
        'バックアップがあり、そこから戻せることを確かめたか。',
      ],
    },
    {
      type: 'p',
      content:
        '共有フォルダが壊れたり、使えなくなったりすると、Access のデータも一緒に使えなくなります。どの進め方を選んでも、権限・記録・バックアップを管理できる形にしておくことが大切です。',
    },

    { type: 'h2', id: 'three-ways', text: '進め方は、3つあります' },
    { type: 'p', content: 'どれが合うかは、ツールの使われ方で変わります。' },
    { type: 'h3', id: 'fix', text: '1. 直して使い続ける' },
    {
      type: 'p',
      content:
        'サポートの続く版に切り替えて、今の Access を使える状態に保ちます。切り替え先は、Microsoft 365 か Office LTSC 2024 です。Microsoft 365 は更新が続きます。Office LTSC 2024 は、2029年10月9日までサポートされます。',
    },
    {
      type: 'p',
      content: '注意したいのは、版を切り替えること自体で、VBA が動かなくなる場合があることです。',
    },
    {
      type: 'ul',
      items: [
        [
          {
            type: 'text',
            text: '64 ビット版の Office では、Windows の機能を呼び出す VBA の命令（Declare 文）に ',
          },
          { type: 'code', text: 'PtrSafe' },
          {
            type: 'text',
            text: ' という指定が必要です。指定がないと、コンパイルの段階でエラーになります。',
          },
        ],
        [
          { type: 'text', text: 'ポインターやハンドルを扱う変数は、' },
          { type: 'code', text: 'LongPtr' },
          { type: 'text', text: ' 型への書き換えが必要です。' },
        ],
        '古い 32 ビットの ActiveX コントロールやアドインは、64 ビット版では読み込めません。',
        'VBA の「参照設定」で、見つからない部品が出ることがあります。',
      ],
    },
    { type: 'p', content: '切り替えの前に、テスト用の PC で動きを確かめるのが安全です。' },
    { type: 'p', content: [{ type: 'strong', text: '合うケース' }] },
    {
      type: 'ul',
      items: [
        '64 ビット版への対応など、直すところがはっきりしている',
        '使う人が少ない',
        '機能が限られている',
        '使う期間が短い',
      ],
    },
    { type: 'h3', id: 'web', text: '2. Web に移す' },
    { type: 'p', content: 'ブラウザで使える Web システムに作り替えます。' },
    { type: 'p', content: [{ type: 'strong', text: '合うケース' }] },
    {
      type: 'ul',
      items: [
        '何人もの人や、複数の拠点で使う',
        'ブラウザやスマートフォンから使いたい',
        '権限や記録の管理（内部統制）が必要',
        'あとから機能を足していきたい',
      ],
    },
    {
      type: 'callout',
      content:
        'Web に移しても、それだけで安全になるわけではありません。権限・記録・バックアップを、移した先でも管理していく必要があります。',
    },
    { type: 'h3', id: 'replace', text: '3. 既製サービスに置き換える' },
    {
      type: 'p',
      content:
        '市販のクラウドサービスなどに切り替えます。作り込みの少ないツールなら、作らずに済むことがあります。',
    },
    { type: 'p', content: [{ type: 'strong', text: '合うケース' }] },
    {
      type: 'ul',
      items: ['どの会社にもある一般的な業務', '既製のサービスの機能で足りる'],
    },
    {
      type: 'p',
      content:
        '1つに決める必要はありません。よく使う機能だけ先に移し、残りは今の Access で使い続ける、という進め方もあります。',
    },

    { type: 'h2', id: 'checklist', text: '今週から始められる、6つの確認' },
    {
      type: 'ol',
      items: [
        [
          { type: 'strong', text: 'ツールと版の一覧を作る。' },
          {
            type: 'text',
            text: ' 部署で使っている Access のツールを書き出し、それぞれの版を「製品情報」で確かめます。',
          },
        ],
        [
          { type: 'strong', text: 'バックアップを取る。' },
          { type: 'text', text: ' ファイルをコピーし、そこから開けることまで確かめます。' },
        ],
        [
          { type: 'strong', text: '直せる人を確かめる。' },
          {
            type: 'text',
            text: ' 中身が分かる人が社内にいるか。作った人が異動や退職をしていないか。',
          },
        ],
        [
          { type: 'strong', text: '32 ビットか 64 ビットかを確かめる。' },
          { type: 'text', text: ' 今の版と、切り替え先の版の両方を確かめます。' },
        ],
        [
          { type: 'strong', text: 'つながっている先を書き出す。' },
          {
            type: 'text',
            text: ' Excel、ほかのデータベース、ほかのシステム、機器とのやり取りがあるか。切り替えで影響を受けやすい部分です。',
          },
        ],
        [
          { type: 'strong', text: '使う人と、止まったときの影響を書き出す。' },
          {
            type: 'text',
            text: ' 何人が使っているか。止まると誰が困るか。進め方を決める材料になります。',
          },
        ],
      ],
    },
    {
      type: 'p',
      content: 'ここまで書き出せば、上司や情報システム部門と話を始められます。',
    },

    { type: 'h2', id: 'diagnosis', text: 'まずは、どれが合うかの目安から' },
    {
      type: 'p',
      content:
        '当社の「無料Web診断（Access版）」では、選択式の質問に答えると、3つの進め方のうちどれが合いそうかの目安が分かります。結果は印刷や PDF で保存できます。',
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
        '結果は、あくまで目安です。どの進め方にするかは、ツールの中身を確かめてから決めます。ご希望の方は、30分のオンライン相談もご利用いただけます。無理な営業はいたしません。',
    },

    {
      type: 'sources',
      items: [
        {
          title: 'Microsoft Learn「Access 2016 - Microsoft Lifecycle」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/products/access-2016',
        },
        {
          title: 'Microsoft Learn「Access 2019 - Microsoft Lifecycle」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/products/access-2019',
        },
        {
          title: 'Microsoft Learn「Access LTSC 2021 - Microsoft Lifecycle」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/products/access-ltsc-2021',
        },
        {
          title: 'Microsoft Learn「Office LTSC 2021 reaching end of support on October 13, 2026」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/announcements/office-ltsc-2021-end-of-support',
        },
        {
          title: 'Microsoft サポート「End of support for Office 2016 and Office 2019」',
          href: 'https://support.microsoft.com/en-us/office/system-requirements/end-of-support-for-office-2016-and-office-2019',
        },
        {
          title: 'Microsoft サポート「End of support for Office 2021」',
          href: 'https://support.microsoft.com/en-us/office/system-requirements/end-of-support-for-office-2021',
        },
        {
          title:
            'Microsoft Learn「Plan an upgrade from older versions of Office to Microsoft 365 Apps」',
          href: 'https://learn.microsoft.com/en-us/microsoft-365-apps/end-of-support/plan-upgrade-older-versions-office',
        },
        {
          title: 'Microsoft Learn「Office LTSC 2024 - Microsoft Lifecycle」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/products/office-ltsc-2024',
        },
        {
          title: 'Microsoft Learn「Ending Support in 2029」',
          href: 'https://learn.microsoft.com/en-us/lifecycle/end-of-support/end-of-support-2029',
        },
        {
          title: 'Microsoft サポート「About Office: What version of Office am I using?」',
          href: 'https://support.microsoft.com/en-us/office/lifecycle/lc-account/about-office-what-version-of-office-am-i-using',
        },
        {
          title:
            'Microsoft Learn「Compatibility between the 32-bit and 64-bit versions of Office」',
          href: 'https://learn.microsoft.com/en-us/office/client-developer/shared/compatibility-between-the-32-bit-and-64-bit-versions-of-office',
        },
      ],
      notes: [
        'Microsoft のライフサイクル表は、日付を米国太平洋時間で表記しています。',
        '（2026年10月時点の情報です）',
      ],
    },
  ],
};
