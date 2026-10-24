---
id: 2026-10-11-public-form-protection
date: 2026-10-11
category: Security
title: "公開フォームの送信対策（#67）"
status: active
superseded_by: []
issues: [67]
paths: ["lib/features/diagnostics/ax-migration/limits.ts", "lib/features/diagnostics/rate-limit.ts", "lib/features/diagnostics/turnstile*.ts", "lib/middleware/csp.ts", "app/api/diagnostics/**"]
---

### [Security] 公開フォームの送信対策（#67）
- **日付**: 2026-10-11
- **決定**: 永続的なレート制限（DB の `public_rate_limits`、固定ウィンドウ）と Cloudflare Turnstile（鍵を2つとも設定したときだけ有効。社内検証の間は無効のまま＝オーナー判断）。組織ごとの上限は受付ではなく通知に掛ける
- **理由**: middleware のレート制限はインスタンスごとのメモリで、Vercel では共有されない。通知を `after()` で確実に送るようにした（#65）ので、大量の送信で営業の受信箱とメールの送信枠をあふれさせられる。送信枠はパスワード再設定のメールと共用
- **ルール**:
  - 上限は `lib/features/diagnostics/ax-migration/limits.ts` にまとめる。送信は IP（30件/時）→メールアドレス（6件/時）の順に数え、断った規則より後は数えない。回答の検証は数える前に行う
  - 組織ごとの上限（通知100件/時、営業メール10通/時・30通/日）を超えても送信は保存する。通知だけを止め、超えた最初の1回だけメンバー（アプリ内）と営業（メール1通）に知らせ、相談申込はリード一覧で確認するよう書く（全員を締め出す使い方をさせない）
  - IP ごとの上限は1時間30件と1日100件（両方を数える）
  - IP のヘッダーは Vercel 上でだけ信じる（`process.env.VERCEL`）。それ以外では IP ごとの上限を掛けない。IPv6 は /64 で数える。キーは鍵付きハッシュで、生の値は保存しない
  - Turnstile は action と hostname を照合する。Cloudflare のテスト用の鍵は本番（`VERCEL_ENV=production`）では通さない。失敗は 403、Cloudflare が答えないときは 503（通さない）
  - Turnstile を有効にする前に、プライバシーポリシーに Cloudflare の利用（IP と端末の情報を送ること）を書く
  - **外部に公開する前に Turnstile を必須にする**（専門レビュー）。鍵がないと、多数の IP からの送信で通知の枠（1時間100件）を使い切り、本物の相談申込の通知を止められる。上限は備えであって、主な防御は Turnstile
  - CSP の要点は `test/unit/lib/middleware/csp.test.ts` で固定する。`style` 属性にユーザーの文字列を入れない
- **既知の限界**: 新規リードの作成と既存リードへの紐づけで DB の処理が数ミリ秒違う（応答の中身は同じ。悪用には送信ごとの上限があり、未登録のアドレスはその1回でリードになる）
- **却下案**: Upstash Redis（アカウントと鍵が要る。DB で足りる量）。組織ごとの上限で受付を止める（1つの IP から全員を締め出せる）。Turnstile を必須にする（社内検証の段階では鍵の準備を待たない）
