# AX サイトの計測（GA4・Search Console）の設定

AX マイグレーションのサイト（`/ja/ax-migration` と、その下の Access LP・コラム、`/ja/ax-diagnosis`）の計測を、公開前（2026-10-29）に設定するための手順です。担当はマーケティング（2026-10-22 決定、`.factory/memory/decisions.md` の [Marketing]）。

## 1. 有効にする（Vercel の環境変数）

どちらも、値を入れて再デプロイするまでは何も読み込みません。`NEXT_PUBLIC_` で始まる変数はビルドに埋め込まれるので、**入れたあとに Production を再デプロイ**してください。

| 変数 | 値 | 入らないとき |
|---|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 の測定 ID（`G-` で始まる値） | GA4 を読み込まない。形が違う値は無視する（`lib/analytics/ga.ts`） |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Search Console の「HTML タグ」で表示される `content="…"` の中の値だけ | 確認用のタグを出さない。タグ全体を貼ると無視する（`lib/seo/site-verification.ts`） |

- 測定 ID と確認用の値は秘密ではありません（ページの HTML に出ます）。
- CSP は、GA4 の ID があるときだけ Google の送信先を許可します（`lib/middleware/csp.ts`）。

## 2. Search Console

- 公開ドメインは 10/28 に決めます。`*.vercel.app` のままなら、ドメイン全体のプロパティは作れないので、**URL プレフィックス**のプロパティ（例：`https://diagnoleads-v2.vercel.app/`）を作り、確認方法は「HTML タグ」を選びます。
- 確認用のタグは、`/ja` と `/en` の下のすべてのページに出ます。
- 確認できたら、サイトマップ `https://<ドメイン>/sitemap.xml` を送信します。テストモードの間は、AX のページも noindex です（`lib/seo/indexing.ts`）。公開（テストモードの解除）後に、インデックスの登録を依頼してください。
- 自社ドメインに移すときは、新しいドメインでプロパティを作り直し、旧ドメインからは 301 で転送します（Search Console の「アドレス変更」も使う）。

## 3. GA4 のイベント

イベントは `trackAxEvent`（`components/features/ax-diagnosis/tracking.ts`）が送ります。

### 共通のパラメータ

`entry` と `from` は、診断がそのページにあるとき、`ax_lp_cta_click` と `ax_cross_link_click` 以外のすべてのイベントに付きます。

| パラメータ | 値 |
|---|---|
| `entry` | 診断を始めたページ：`ax-lp`（メイン LP）／`ax-access-lp`（Access LP）／`ax-diagnosis`（単独の診断ページ） |
| `from` | ほかの AX ページから来たときの、元のページと置き場所：`<ページ>-<置き場所>`（例：`ax-lp-targets-access`、`ax-column-end`）。許可した値だけ（`lib/features/ax-site/cross-links.ts`） |

- ページ：`ax-lp`／`ax-access-lp`／`ax-column-index`／`ax-column`／`ax-diagnosis`
- 置き場所：`header`／`footer`／`breadcrumb`／`targets-access`／`hosts`／`paths`／`related`／`body`／`end`／`result`
- `result` は、Access の診断結果の下に出す、回答に合うコラム1本へのリンク（#363）。ページは診断を表示しているページなので、`entry` と同じく `ax-diagnosis-result`（単独の診断ページ）／`ax-access-lp-result`（Access LP）／`ax-lp-result`（メイン LP）のどれかになる

### イベントの一覧

| イベント | いつ | パラメータ |
|---|---|---|
| `ax_lp_cta_click` | 診断・相談のボタンを押した | `cta`（`diagnosis`／`consultation`）、`location`、`page` |
| `ax_cross_link_click` | ほかの AX ページへのリンクを押した | `from_page`、`to_page`、`location`、`to_section`（移動先に # があるとき）、`column_slug`（コラムのページから。`location=result` のときは、結果が案内したコラム） |
| `ax_diagnosis_start` | 診断を始めた | `platform` |
| `ax_diagnosis_step` | 次の質問へ進んだ | `platform`、`step` |
| `ax_diagnosis_complete` | 結果を表示した | `platform`、`difficulty`、`urgency`、`primary_challenge`、`access_path`（Access のみ）、`consultation_requested` |
| `ax_consultation_request` | 個別相談を申し込んだ | `source`（`form`／`result`）、`platform`、`location`（`result` のとき） |
| `ax_meeting_preferences` | 希望日時を送った | `platform` |
| `ax_diagnosis_follow_up` | 結果のあとの追加質問に答えた | `answered`、`total`、`access_path`（Access のみ） |
| `ax_result_print` | 結果を印刷・PDF 保存した | `platform`、`location` |
| `ax_document_request`／`ax_seminar_request` | 資料・勉強会を申し込んだ | `platform` |
| `ax_result_email_request` | 結果をメールで受け取るボタンを押し、受け付けられた（`AX_RESULT_EMAIL_ENABLED` が有効のときだけ表示。#154） | `platform`、`status`（常に `accepted`。同じ診断からの2回目の申込も同じ値） |

`ax_lp_cta_click` の `location` の主な値：`hero`、`final`、`header`、`floating`、`as400`、`acos`、`targets-access`、`access-hero`、`access-paths`、`access-final`、`column-end-<slug>`。

### 注意

- コラムのヘッダーのボタンと記事の最後のボタンは、ほかのページへ移るので、`ax_lp_cta_click` と `ax_cross_link_click` の**両方**が送られます。クリック数を出すときは、どちらか一方だけを数えてください。
- `from` と `utm_*`・`ref`・`agency` は、ほかの AX ページへ移るときに引き継がれます（リンク自体は素の URL で、押したときに付けます）。

## 4. GA4 で設定すること（公開前）

1. **カスタムディメンション**（スコープ：イベント）を登録する：
   `entry`、`from`、`page`、`from_page`、`to_page`、`to_section`、`column_slug`、`cta`、`location`、`platform`、`step`、`difficulty`、`urgency`、`primary_challenge`、`access_path`、`consultation_requested`、`source`
2. **キーイベント**にする：`ax_diagnosis_complete`、`ax_consultation_request`（必要なら `ax_document_request`、`ax_seminar_request`）
3. 社内からのアクセスを除外するなら、GA4 の「内部トラフィック」の設定で、社内の IP を登録する（IP はコードに書かない）。

## 5. 見たい数字と、見方の例

| 知りたいこと | 見方 |
|---|---|
| LP ごとの、診断の開始から完了までの割合 | `ax_diagnosis_start` と `ax_diagnosis_complete` を `entry` で分ける |
| メイン LP の Access の人が、その場で診断したか、Access LP に移ったか | その場：`entry=ax-lp` かつ `platform=access`。移った：`entry=ax-access-lp` かつ `from=ax-lp-targets-access` |
| どのコラムが診断につながったか | `ax_cross_link_click` の `column_slug`（`location=result` を除く）、`ax_lp_cta_click` の `location=column-end-<slug>` |
| 診断結果から、どのコラムが読まれたか | `ax_cross_link_click` の `location=result` を `column_slug` で分ける。コラム側の流入は `from` が `-result` で終わるもの |
| 基幹システムの人が Access LP から移れたか | `ax_cross_link_click` の `from_page=ax-access-lp`、`location=hosts`、`to_section` |

回答の記録（DB の `diagnostic_submissions.tracking`）にも、`entry`・`from`・UTM・`agency`・`ref` が残ります。
