import type { HelpArticle } from '../types';

export const officeArticle: HelpArticle = {
  id: 'office',
  locale: 'ja',
  title: 'AI社員オフィス',
  summary:
    '組織で採用した AI社員の席と働きぶりを、オフィスの間取りで見ます。管理者は空席から AI社員を採用し、名前の変更・休止・解雇ができます。',
  routes: ['/office'],
  reviewedAt: '2026-11-12',
  blocks: [
    { type: 'h2', id: 'floor', text: '間取りの見方' },
    {
      type: 'p',
      content:
        '営業フロア・分析室・企画室の3つの部屋に、役割ごとの席があります。1つの役割に採用できる AI社員は1人です。点線の席は空席です。',
    },
    {
      type: 'table',
      header: ['役割', '部屋', '仕事'],
      rows: [
        [
          '追客担当',
          '営業フロア',
          '期限が近い・過ぎた次の行動を毎朝数える（リードは書き換えない）',
        ],
        [
          'AI評価担当',
          '分析室',
          '評価のない新しいリードを Claude で評価する（個人を指す項目は送らない）',
        ],
        ['時期の見張り番', '企画室', 'リードの動くべき時期を毎朝計算し直す'],
      ],
    },
    { type: 'h2', id: 'status', text: '状態' },
    {
      type: 'table',
      header: ['表示', '意味'],
      rows: [
        ['作業中', 'いま作業している'],
        ['待機中', '次の作業を待っている'],
        ['要確認', '最後の作業が失敗したか、終わっていない。作業記録を確かめる'],
        ['研修中', 'この役割の仕事はまだ準備中で、働かない'],
        ['休止中', '管理者が休止した。再開するまで働かない'],
        ['空席', 'この役割の AI社員はまだいない'],
      ],
    },
    {
      type: 'p',
      content:
        '上の数字は、在籍・作業中・今日の処理件数（今日成功した作業で扱った件数の合計）・要確認です。画面は1分ごとに読み直します。',
    },
    { type: 'h2', id: 'hire', text: 'AI社員を採用する' },
    {
      type: 'steps',
      items: [
        '空席を押します。',
        '表示名を確かめ、必要なら変えます（40文字まで）。',
        [
          { type: 'ui', text: '採用する' },
          { type: 'text', text: 'を押します。' },
        ],
      ],
    },
    { type: 'h2', id: 'manage', text: '名前の変更・休止・解雇' },
    {
      type: 'p',
      content: [
        { type: 'text', text: 'AI社員の席を押すと、詳細と作業記録が出ます。' },
        { type: 'ui', text: '名前を変える' },
        { type: 'text', text: '・' },
        { type: 'ui', text: '休止する' },
        { type: 'text', text: '（休止中は' },
        { type: 'ui', text: '再開する' },
        { type: 'text', text: '）・' },
        { type: 'ui', text: '解雇する' },
        { type: 'text', text: 'から操作します。' },
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content: '解雇すると、その AI社員の作業記録も消え、元に戻せません。',
    },
    {
      type: 'roles',
      roles: ['member', 'parent_viewer'],
      content:
        'メンバーと親組織の閲覧者は、オフィスと作業記録を見られますが、採用と管理はできません。',
    },
  ],
};
