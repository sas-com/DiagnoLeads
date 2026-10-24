---
id: 2026-10-22-email-templates
date: 2026-10-22
category: Email
title: "メールは共通の部品で作り、1つの送信関数で送る（#285）"
status: active
superseded_by: []
issues: [285]
paths: ["lib/email/**", "lib/features/email/**"]
---

### [Email] メールは共通の部品で作り、1つの送信関数で送る（#285）
- **日付**: 2026-10-22
- **決定**: 配信するメール（社内向け・お客様向けとも）は、`lib/email/templates/render.ts` の `renderEmail({ theme, preheader, blocks, footer })` で HTML とテキスト版を作り、`@/lib/features/email` の `sendEmail` で送る。見た目は社内向け（DiagnoLeads）とお客様向け（AX のブランド色）の2種類。オーナーが全15通の見本を確認して決めた
- **理由**: 各機能が HTML を文字列で組み立て、エスケープ関数が6か所に分かれていた。書き忘れても気づけず、旧診断の結果メールは入力値をエスケープしていなかった。送信の仕組みも3つあり、認証メールはテキストだけだった
- **却下案**: react-email（以前ビルドが通らず止めていた。依存を増やさずに、表組みとインラインの CSS で足りる）
- **ルール**:
  - 機能のコードで HTML の文字列を組み立てたり、`escapeHtml` を書いたりしない。値は部品の中でエスケープされる。足りない部品は `render.ts` に足す
  - リンクは https（本番以外では localhost の http も可）だけがボタン・リンクになる。それ以外は外され、警告がログに出る（スキームとホストだけ）。アプリの URL（`NEXT_PUBLIC_APP_URL`・`BETTER_AUTH_URL`）を http にすると、リンクのないメールが届くので注意
  - 外部の画像・フォント・スクリプトは使わない（開封の追跡やブロックを避ける）。件名は `sendEmail` が1行にする
  - 宛先の制限（`filterAllowedRecipients`、テストモード）は `sendEmail` の中で行う。Resend を直接呼ばない
  - 参考にする実装: 社内向けは AX 診断の `buildSalesEmail`（`lib/features/diagnostics/ax-migration/notify.ts`）、お客様向けは `buildConfirmationEmail`（`lib/features/meeting-requests/service.ts`）
  - 旧診断の結果メール（`lib/features/email/templates/diagnostic-result.ts`）の問い合わせ先は仮の値のまま。旧フォームを有効にする前に差し替える
