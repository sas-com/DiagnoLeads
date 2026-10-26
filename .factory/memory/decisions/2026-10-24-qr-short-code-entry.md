---
id: 2026-10-24-qr-short-code-entry
date: 2026-10-24
category: Security
title: "QR キャンペーンの入口は /q/<短縮コード>。転送先は DB の値とアプリのルートだけから作る（#503）"
status: active
superseded_by: []
issues: [503, 41, 120, 610, 663, 692, 695, 698, 700, 702, 705, 788]
paths: ["app/q/**", "lib/features/distribution/short-code-entry.ts", "lib/features/distribution/types.ts", "lib/features/distribution/scans.ts", "lib/features/distribution/service.ts", "lib/features/distribution/limits.ts", "lib/features/distribution/qr-code.ts", "lib/features/distribution/router.ts", "lib/features/distribution/campaign-expiry.ts", "lib/middleware/rate-limit.ts", "lib/features/diagnostics/organization.ts", "lib/multi-tenant/helpers/diagnosis-organization.ts", "lib/features/diagnostics/service.ts", "lib/features/diagnostics/tracking.ts", "lib/features/diagnostics/ax-migration/submission-service.ts", "lib/features/diagnosis-builder/submission-service.ts", "app/api/diagnostics/ax-migration/route.ts", "app/api/diagnoses/[slug]/submit/route.ts", "components/features/diagnosis-runner/tracking-params.ts", "lib/features/analytics/service.ts", "lib/features/agency-links/api/router.ts", "components/features/distribution/**", "app/[locale]/(dashboard)/settings/qr-campaigns/**"]
---

### [Security] QR キャンペーンの入口は /q/<短縮コード>。転送先は DB の値とアプリのルートだけから作る（#503）
- **日付**: 2026-10-24
- **決定**: QR キャンペーンの画面は使い続け、QR の URL を直す（オーナー判断、#503 のコメント）。QR の URL は `/q/<短縮コード>`。入口は `[locale]` の外の Route Handler（`app/q/[code]/route.ts`）で、開いているキャンペーンを短縮コード（大文字と小文字を区別）で探し、診断へ 307 で転送する
  - 行き先（2026-10-25 に #663 で変えた。下の「オーナーの判断」）
    - `qr_campaigns.diagnosis_id` があるキャンペーン：その診断がキャンペーンと同じ組織にあり、`/d/<slug>` がその診断を出すとき（`findPublicDiagnosis` が同じ id を返すとき）は `/ja/d/<slug>`。出さないとき（停止中・アーカイブ・下書き・ほかの組織と slug がぶつかっている・ほかの組織の診断）は 404。AX 診断へは送らない
    - `diagnosis_id` がないキャンペーン：キャンペーンの組織が `resolveDiagnosisOrganizationId()`（`lib/features/diagnostics/organization.ts`。AX 診断の回答をリードにする組織）と同じときだけ AX 診断（`/ja/ax-diagnosis`。`/diagnostic/[slug]` と同じ）。ほかの組織のキャンペーンと、その組織が設定されていないときは 404（設定されていないことは、インスタンスごとに1回 `console.error` に出す。配った QR が黙って止まらないように）
  - UTM はキャンペーンの列（utm_source・utm_medium・utm_campaign・utm_content）を付ける。キャンペーンの短縮コードも `qr` として付ける（#700、下の「スキャンからリードまで」）。言語は既定の `ja`
  - 停止中・期限切れ・存在しないコードは 404（本文は `Not Found` だけ）。どの応答も `Cache-Control: no-store` と `X-Robots-Tag: noindex, nofollow`
  - 回数制限の 429 は、入口（DB の制限）でも proxy（メモリの制限）でも、日本語1行の text/plain（`QR_ENTRY_TOO_MANY_REQUESTS_TEXT`）。QR を読んだスマートフォンは本文をそのまま表示するので JSON にしない。入口にはロケールがなく、転送先も `/ja/` なので日本語だけ
  - 1回の読み取りは `maxDuration = 15` 秒まで（`vercel.json` の30秒は `app/api/**` だけに掛かる。DB のクライアントには SQL の実行時間の上限がない）。接続の待ち（10秒、`lib/db/client.ts`）とその後の通知が収まる長さ
  - 保存済みの `qr_campaigns.tracking_url`（#503 より前は `/d/<コード>`）は読まない。一覧の Copy URL・詳細・Download QR は、短縮コードと UTM の列から毎回 URL を作る（本番の行を書き換えない）。新しいキャンペーンは `/q/` の URL を保存する
  - 使われていなかった `distribution.generateQRCode`（テンプレートの id で `/d/` を作っていた）は外した
- **オーナーの判断（2026-10-25、#663 のコメント）**: #633 のレビューで出た3つを、オーナーが決めた
  1. ほかの組織のキャンペーン：`campaign.organizationId` が `resolveDiagnosisOrganizationId()` と同じときだけ AX 診断へ送り、ほかの組織のキャンペーンは 404 にする（その組織の診断を `diagnosis_id` で設定できるようになる #120 まで）。ほかの組織の来訪者の個人情報（氏名・会社・メールアドレス・キャンペーンの UTM）を、運営の組織がリードと訪問の記録で受け取る経路をなくすため
  2. 回数制限：QR を配る催しの想定の最大人数は100人。その2倍で、DB の制限（アドレスごと）を10分に200回、proxy のメモリの制限（アドレスとコードごと）を1分に200回にする。一斉の読み取りは開始の数分に集まるので、人数より少ない上限は会場の Wi-Fi（1つの NAT のアドレス）で必ず当たる。上限は1つのアドレスの検索の回数を抑えるためのもの（コードは 55^8 通り）で、上げても守りはほとんど落ちない
  3. 公開されていない診断：`diagnosis_id` があるのに `/d/<slug>` がその診断を出さないとき（停止中・アーカイブ・slug の衝突）は 404 にする。案内と違う診断に回答させない。診断の停止は作った人の意図した操作なので、QR も止まるほうが期待に合う
- **オーナーの判断（2026-10-25、#700 のコメント）**: スキャンからリードまでは、短縮コードで数える（#700 の本文の案 A・B のどちらでもない）
  - 入口は転送先にキャンペーンの短縮コードを付ける。値はキャンペーンの行から取り、リクエストの値は入れない
  - 診断の回答は、UTM と同じように、そのコードを計測の値として持つ。回答からリードができたときに、同じ組織のそのキャンペーンの `completion_count` を1回だけ数える。同じ回答の再送と、ほかの組織のキャンペーンには数えない。AX 診断とビルダーの診断の両方で数える
  - スキャンの行とリードは結ばない（`qr_scans.converted`・`lead_id` は使わない）。転換率は `qr_campaigns` の `completion_count` と `scan_count` から出す
  - 案 A（UTM の一致）を取らない理由：既定の UTM（qrcode / offline）が同じキャンペーンが多いと、どのキャンペーンか決められない。案 B（入口の1回限りの印からスキャンの行を探す）を取らない理由：スキャンの行が個人に結び付く記録になり、ポリシーへの記載と保存期間の決定（法務）が先に要る。#702（`lead_id` の索引）も待たなくてよい
  - 既知の限界として受け入れた：URL のコードを書き換えると、同じ組織のほかのキャンペーンに数えられる（数が狂うだけで、データは漏れない）
- **オーナーの判断（2026-10-26、#700 のコメント）**: PR #774 のスペシャリストのレビュー（security・architecture・marketing の3人。どれも blocker なし）を受けて決めた
  - 数え方は作者の判断のとおりにする：① 数え損ねてもリードは残す（キャンペーンの行の待ちは3秒まで。数え損ねたら応答の後に `reportServerError` で知らせる）② 停止中・期限切れのキャンペーンも期限なく数える ③ 新規リード率は100%で切らない ④ **読み取りが0件のときは率を「—」と出す**（算出できないことが分かるように。それまでの0%から変えた）
  - 画面の言葉：「読み取り回数」「新規リード」「新規リード率（新規リード ÷ 読み取り回数）」。リード一覧の「コンバージョン率」（受注率）と同じ言葉は使わない。使っていなかった `settings.qrCampaigns.conversionCount`（「コンバージョン数」）と、同じく使っていなかった `scanCount`・`conversionRate` の文言は消した
  - 数字の下に1行の注記：作成日からの累計（日を出す）、既存のリードの回答は新規リードに含まない、停止・期限切れの後に届いた回答も数える、リードを消しても新規リードの数は減らない。新規リードが読み取り回数より多いときは、その理由の注記も添える
  - 内訳もこの PR で出す：既存リードの再回答（率の分子に混ぜず、別の数）と、新規リードのうち関心あり（MQL）・相談申込
  - 画面の小さな注記（マーケティングのレビュー）：作成のダイアログに「動作の確認は確認用のキャンペーンで行い、配るものは確認のあとに新しく作る」、URL をコピーの横に「メールや Web で配るときは、媒体ごとに別のキャンペーンを作る」、名前の例を日本語（「例：2026-11 製造業DX展 ブース」）にして、イベントや配布物ごとに1つのキャンペーンを作ると添える
  - 別の Issue に分けた（#788）：既定の `utm_medium=offline` では流入元が「未設定」になる。キャンペーンの medium を `INFLOW_SOURCES` に対応する一覧から選ぶようにし、セミナー・展示会・DM の割り当てはオーナーが決める（DM に当たる値は今ない）
  - `qr_scans` の使わない列（`lead_id`・`converted`・`session_id`）は #702 で落とす（#774 のマージの後、本番に当ててから）
- **理由**:
  - `/d/[slug]` は診断ビルダーの公開ページ（#116）で、slug を探す。短縮コードを `/d/` に置くと開かず、小文字と数字だけのコードは、同じ slug を公開しているほかの組織の診断を開けた
  - 転送先をリクエスト（ホスト・クエリ・ヘッダー）から作ると、オープンリダイレクトやほかの組織の診断への誘導の入口になる。Location はアプリのパスだけ（相対）にし、訪問者は QR を読んだホストにとどまる
  - `[locale]` の下のページにすると、ロケールの振り分けで2回転送になり、429 を返せない
- **ルール**:
  - 回数制限：DB（`public_rate_limits`）で、アドレスごとに10分200回（`QR_ENTRY_RATE_LIMITS`、Vercel の上でだけ。決定 `2026-10-11-public-form-protection` と同じ扱い）。proxy のメモリの制限は `/q/` で1分200回（`lib/middleware/rate-limit.ts`。アドレスとパスごと、インスタンスごとに数えるので、コードをまたいだ制限にはならない）。どちらも「催しの最大人数100人の2倍」（2026-10-25 のオーナーの判断）から出した値で、変えるときは両方を合わせ、この決定を更新する。コードの形（`SHORT_CODE_PATTERN`）は数える前に確かめる
  - 行き先を足すときも、キャンペーンが名指しした診断（`diagnosis_id`）があれば、そこか 404 にする。名指しした診断が使えないときに、ほかの診断（AX 診断を含む）へ回さない。AX 診断へ送るのは、AX 診断の回答を受け取る組織のキャンペーンだけ
  - 入口の転送先に、リクエストの値を入れない。行き先の候補を増やすときは、組織をキャンペーンの行から取り、そのページが同じ組織の行を出すことを確かめる
  - `/q/` は `lib/i18n/middleware.ts` のロケールの振り分けから外す。`lib/middleware/cache-headers.ts` も `no-store` にする
  - スキャンの記録（#41、2026-10-25）：入口が転送したスキャンごとに、`qr_scans` に1行を足し、`qr_campaigns.scan_count` を1増やす（`recordQrScan`、`lib/features/distribution/scans.ts`）
    - 回数制限の後に数える。404・429・500 と、ボット（`/api/collect` と同じ `isBot`。UA のないものも）・HEAD（Next.js が GET の関数で答える。誰も診断へ行かない）は記録しない（HEAD を記録しないのは作者の判断。オーナー未確認）
    - キャンペーンごとに1日（日本時間）2,000件の上限（`QR_SCAN_DAILY_CAP`、`lib/features/distribution/limits.ts`）。記録の前に「キャンペーンの id と日」で `public_rate_limits` に数え、超えたら転送だけして記録しない。超えた最初の1件だけ `console.warn`（キャンペーンの id と日）と `reportServerError('qr-entry/scan-daily-cap')` で知らせる。アドレスごとの回数制限は多数のアドレスからの水増しを止めないため（2026-10-25 の読み取り専用のレビュー。訪問の計測の組織ごとの上限と同じ形）。組織ごとでなくキャンペーンごとにしたのは、1つのコードへの水増しで同じ組織のほかのキャンペーンの記録が止まらないようにするため。値は催しの最大人数（100人）の20倍。単位と値は作者の判断で、オーナー未確認（PR #704）。変えるときはこの決定を更新する
    - 1回のスキャンの記録は1文（`scan_count` を増やす UPDATE と、その行の組織で INSERT する CTE。ほかに1日の上限を数える `public_rate_limits` の1文）。行と数は食い違わず、同時のスキャンも行のロックで全部数える。キャンペーンが消えていれば何も書かない。組織はキャンペーンの行から取る
    - 書き込みは応答の後（`after()`）。転送を待たせない。失敗しても転送は変わらず、入口のほかのエラーと同じく `console.error`（エラーの名前だけ）と `reportServerError('qr-entry/scan')` で知らせる。1日の上限を数えられなかったときも同じ
    - 残すのは、キャンペーン・組織・端末の種類（`deviceOf`）・日（日本時間の0時。`scanned_at` はタイムゾーンのない列）だけ。IP（とそのハッシュ）・UA・位置・セッション・時刻は残さない（決定 `2026-10-23-site-visit-measurement` と同じ。時刻があると、同じ時刻の診断の回答と突き合わせられる）。人を指すものを持たないので、訪問の計測のような有効化の環境変数は置かない（作者の判断。オーナー未確認。プライバシーポリシーに書く前に記録を始めてよいかは、法務の確認待ち（PR #704 のレビュー））
    - UA の判定（`isBot`・`deviceOf`、`lib/features/site-visits/request.ts`）は入口（app）で組み合わせ、`distribution` からは読まない（下の import の決まり）。UA の判定は先頭の512文字だけで行う（`deviceOf` のタブレットの正規表現は UA の長さの2乗の時間がかかり、入口では 307 を返す前に動くため）。PR #704 では入口で切っていたが、#705 で `isBot`・`deviceOf` の中で切るように移し、入口は UA をそのまま渡す（`/api/collect` と同じ。決定 `2026-10-23-site-visit-measurement`）
    - `getCampaignStats` は、合計を `scan_count`、端末の内訳を `qr_scans` の集計（DB で数える。全行を読まない）から返す（新規リード率は #700 から `qr_campaigns` の行。下の「スキャンからリードまで」）。直近の10件は id・端末・日（`scannedOn`、日本時間の `YYYY-MM-DD` の文字列）だけを返す（#700 で converted を外した）。日を Date で返すと、タイムゾーンのない列の0時が UTC として読まれ、画面では日本時間の9:00に見えるため
  - スキャンからリードまで（#700、2026-10-25。上の「オーナーの判断（#700）」）
    - 入口：転送先（AX 診断と `/d/<slug>` の両方）に `qr=<短縮コード>` を付ける（`QR_CODE_PARAM`・`qrEntryRedirectPath`）。`QR_CODE_PARAM` は `distribution/types.ts` に置き、診断の画面（`readTrackingParams`）も同じ名前を読む（2026-10-26 のレビューの nit。ブラウザが入口の DB のコードを読まないように）。コードはキャンペーンの行の `short_code`（`findOpenQrCampaign` が読む）で、パスのコードもクエリも使わない。状態コード・回数制限・スキャンの記録・ヘッダーは変えていない。印刷済みの QR はそのまま使える（転送のときに付けるため）
    - 回答：`readTrackingParams`（`components/features/diagnosis-runner/tracking-params.ts`）が `qr` を読み、`SHORT_CODE_PATTERN` に合うものだけを送る。長すぎる値は切らずに捨てる（2026-10-26 のレビューの nit。65文字以上の値の先頭64文字が、ほかのキャンペーンのコードになりうるため。それまでは64文字で切っていた）。`trackingSchema`（`lib/features/diagnostics/tracking.ts`）も `SHORT_CODE_PATTERN` に合うものだけを残す。合わないものは捨て、回答は拒まない（ほかの計測の値と同じ）。UTM と同じく `diagnostic_submissions.tracking` に残る
    - 数え方：回答がリードを作ったとき（`upsertLeadFromSubmission` が既存のリードを返さなかったとき）だけ、リードと同じ組織で、その短縮コード（大文字と小文字を区別）を持つキャンペーンの `completion_count` を1増やす。数えないもの：同じ回答の再送と送り直し（既存のリードに結び付く。同時の二重送信も勧告ロックで後の方が既存になる）、すでにあったリード、ほかの組織のキャンペーンのコード、どのキャンペーンにもないコード、形の合わないコード、テストの回答（`is_test`。今はどの公開の経路も書かないが、ビルダーのプレビュー #117〜#121 に備える）
    - 停止中・期限切れのキャンペーンも、期限なく数える（作者の判断を、2026-10-26 にオーナーが確かめた②）：読み取りはキャンペーンが開いている間にあった。催しの終わりに止めても、回答の途中の人の分を落とさない。消したキャンペーンは数えない（行がない）
    - 置き場所：数える文は `distribution/service.ts` の `countCampaignCompletion`（`qr_campaigns` を書くのは distribution だけ）。いつ数えるかの規則は `diagnostics/service.ts` の `countQrCompletion`（AX とビルダーで共有する規則。決定 `2026-10-24-diagnosis-shared-rules-unified`）で、両方の `submission-service.ts` が呼ぶ。機能の向きは diagnostics → distribution（公開面の `service.ts`・`types.ts`）だけが増え、distribution はほかの機能を読まないままなので、`features-in-cycles` は増えない
    - 内訳の置き場所（2026-10-26）：内訳は回答（`diagnostic_submissions`）とリード（`leads`）から数えるので、distribution（ほかの機能を読まない）には置かない。集計は analytics の公開面 `lib/features/analytics/service.ts` の `qrCampaignBreakdown` に置き、tRPC は `analytics.getQrCampaignBreakdown`（`read Lead`、`ctx.organization` の組織だけ）。画面（`settings/qr-campaigns`）が `distribution.listCampaigns` の行とキャンペーンの id で並べる（まとめるのは画面。distribution のルーターは analytics を読まない）
      - 関心あり（MQL）と相談申込の規則は、リード一覧の規則をそのまま使う（`leadIsInterested`・`leadRequestedConsultation`。leads の公開面 `service.ts` から読む。書き写さない）。`leadIsInterested` は一覧の MQL 段階（`listMqlLevel`）が関心ありであること、`leadRequestedConsultation` は一覧の相談申込の絞り込み（`conversion_point = 'consultation'`）で、どちらも `list-sql.ts` の1か所に置く。一覧の「相談申込なし」の絞り込みも `leadRequestedConsultation` の否定で作る（2026-10-26 の architecture のレビューの nit。それまでは `'interest'` と `'consultation'` を別の場所でも直書きしていた）
      - 1回のクエリで、組織のすべてのキャンペーンを数える（キャンペーンごとに聞かない）。一覧の `listCampaigns` も組織のすべてのキャンペーンを返すので、画面に並ぶキャンペーンと同じ。一覧を分けて出すようにするときは、ページのキャンペーンの id を渡す形にする
      - 機能の向きは analytics → leads（もとからある）だけで、analytics は distribution を import しない（`qr_campaigns` は同じクエリで表として読む）。`arch:check` の許可リストは変わらない（`features-in-cycles`・`cross-feature-internal` とも増えない）
    - 時機：リードを作るトランザクションの中で、リードと回答を書いた後に、最後の文として数える（応答の後の `after()` にしない）。リードの作成は `upsertLeadFromSubmission` のトランザクションの中にあり（同じアドレスの同時の送信を勧告ロックで並べる）、同じトランザクションなら数はリードと一緒に確定し、取り消される。失敗した送信の送り直しで2回数えることも、リードのない数が残ることもない。`after()` だと、数えられなかったときに落ち、1回だけを別に保証することになる。足すのは、コードのある新しいリードのときだけで、savepoint の中の UPDATE 1文（`short_code` の一意の索引で1行を更新する）と、その前後の設定で4往復（SAVEPOINT・`lock_timeout` の設定・UPDATE・設定の戻し）。数え損ねたときも、失敗はほぼ UPDATE（RLS や権限の拒否・待ちの上限）で起き、設定の戻しの代わりに ROLLBACK TO SAVEPOINT を送るので4往復。5往復になるのは設定の戻しが失敗したときだけ（2026-10-26 の security のレビューの nit。postgres-js 3.4.0 の `scope()` で確かめた。それまでは「数え損ねたときは5往復」と書いていた）。コードのない回答では DB に何も聞かない。postgres-js（drizzle の入れ子のトランザクションが使う `sql.savepoint`）は RELEASE SAVEPOINT を送らないので、成功した savepoint は開いたまま、外のトランザクションと一緒にコミットされる（2026-10-26 の security のレビューの nit。それまでは「savepoint を閉じる」と書いていた）。キャンペーンの行のロックは UPDATE からコミットまで（設定の戻しとコミットの2往復）持ち、その間、同じキャンペーンのスキャンの記録と回答は待つ。同時の回答も行のロックで全部数える
    - 数え損ねてもリードは落とさない（2026-10-25 の PR #774 の読み取り専用のレビューの should-fix。リードを数より優先するのは作者の判断を、2026-10-26 にオーナーが確かめた①）：数える文は、そのトランザクションの savepoint（`tx.transaction`）の中で動き、キャンペーンの行を `QR_COMPLETION_LOCK_TIMEOUT`（3秒）まで待つ（`lock_timeout` は数える間だけ。savepoint の最後の文で前の値に戻す。savepoint は閉じず、外のトランザクションと一緒にコミットされる）。失敗したとき（RLS のポリシーや権限 #51、待ちの上限、ほかの DB の失敗）は savepoint まで戻し（ROLLBACK TO SAVEPOINT。中で変えた `lock_timeout` も戻る）、回答とリードはそのまま保存して、送信は成功として答える。エラーの名前とコードだけを `console.error` に出し（メッセージには文と値が入るので出さない）、ルートが応答の後に `reportServerError`（`ax-diagnosis/qr-completion`・`diagnosis/qr-completion`）で知らせる。savepoint は外のトランザクションと一緒に確定・取り消されるので、「リード1件に1回まで」は変わらない（数え損ねたリードは0回）。DB の接続が切れたときなど、外のトランザクションまで失敗するときは、今までどおり送信も失敗する
    - 数の出どころ：`getCampaignStats` の `totalConversions` と `conversionRate` は、どちらも `qr_campaigns` の行（`completion_count`、`completion_count / scan_count`）から出す。率の計算は `distribution/types.ts` の純粋な関数 `campaignNewLeadRate` の1か所だけ（DB を読まないので、画面とサーバーの両方が使う。2026-10-26 に、画面の別の式と `scans.ts` の式をこれにまとめた）。丸めは小数第1位の1回だけ、読み取りが0件なら `null`（画面は「—」、`getCampaignStats` は `conversionRate: null`）。設定画面の一覧も同じ2列から出す（もとから）。`campaignScanStats` は `qr_scans.converted` を読まなくなり、直近のスキャンから `converted` を外した
    - `qr_scans.converted`・`lead_id` は使わない（書かない・読まない）。スキャンの行は今のまま（キャンペーン・組織・端末の種類・日）。列は #702 で落とす
    - 画面（2026-10-26 のオーナーの判断。`components/features/distribution/qr-campaign-results.tsx`、文言は `settings.qrCampaigns.results`）
      - キャンペーンの行の数：読み取り回数（`scan_count`）・新規リード（`completion_count`）・新規リード率（`campaignNewLeadRate`。読み取り0件は「—」と「算出できません」。「—」は読み上げから外し、理由の文を読ませる。率も件数と同じく `format.number` で桁を区切る）。3つは同じ `dl` に同じ形で並べる。新規リードが読み取り回数より多いときは、その理由（読み取りとして数えない来訪と、QR から開いた診断ページのアドレスを転送・ブックマークして後から回答した分も数える）を添える
      - 内訳（`analytics.getQrCampaignBreakdown`）：回答の `tracking->>'qr'` がキャンペーンの短縮コード（大文字と小文字を区別）で、キャンペーンと同じ組織、キャンペーンの作成から後、`is_test = false` の回答を数える
        - 新規リードのうち関心あり（MQL）・相談申込：その回答のうち `lead_created = true` のリード（同じ組織）を、リード一覧の MQL 段階（MQL の日付があれば関心あり）と相談申込の絞り込みで数える。リードの今の状態で数える（画面にも「リードの今の状態で数えます（削除したリードは入りません）」と出す）。枠（`fieldset`。見出し「新規リードのうち」で名前を付ける）にはこの2つだけを入れる。関心あり・相談申込が新規リードより多いとき（数え損ねた新規リードがあるとき）は、その理由を添える
        - 既存リードの再回答：その回答のうち `lead_created = false`（回答の時点で同じメールアドレスのリードがあった回答）の件数。新規リードにも率にも入れない。新規リードの一部に見えないように、枠の外に別の行で出す（2026-10-26 のスペシャリストのレビュー（marketing・ui-ux・architecture）の should-fix）。説明に、取り込んだリードや営業経由のリードの初めての回答と、このキャンペーンで新規リードになった人の送り直しも入ることを書く（ラベルはオーナーの言葉のまま。下の「内訳の限界」）
        - 読み込み中は Skeleton、読めなかったときは「内訳を読み込めませんでした」と出す（何も出さないと、内訳がないのか読めていないのか分からない）
      - 注記（1行）：作成日（日本時間）からの累計、既存リードの回答は新規リードに含まない、停止・期限切れの後に届いた回答も数える、リードを消しても新規リードの数は減らない。置き場所はオーナーの判断のとおり数字の下（ui-ux のレビューはページ上部に1回だけ置く案を出した。オーナーの確認待ち）
      - 「URL をコピー」で配るのは入口 `/q/<コード>` なので、その URL を開いた回数も読み取り回数に入る。URL の横の注記に書く（2026-10-26 の marketing のレビューの should-fix）
      - 作成のダイアログ：確認用のキャンペーンの注記は説明（`DialogDescription`）の中の Callout にし、開いたときに読み上げる。確認で作ったリードはリード一覧に残ることも書く。フォームは `max-h-[90vh]` で窓の中をスクロールする（狭い画面でボタンが外に出ないように）
      - 停止中のキャンペーンは、カードを薄くせず（`opacity-60` をやめた。小さい灰色の文字が AA に届かなかった）、見出しに「停止中」の Badge を出す。停止中も数え続けるので、数字は読める濃さのままにする
    - プライバシー：リードの回答の `tracking` に、キャンペーンの短縮コードが入る。キャンペーンを指す値で、人を指すものではない（`utm_campaign` と同じ種類）。スキャンの行とリードは結ばない（列も索引も足さない）。ただし、回答は `tracking.qr` と作成の時刻を、スキャンの行はキャンペーン・日・端末の種類を持つので、件数が少ない日は、日とコードでスキャンの行と回答を突き合わせられる（DB を読める人・バックアップ。分かるのは端末の種類だけ。2026-10-25 の PR #774 の読み取り専用のレビューの nit）。下の保存期間の限界は変わらない
  - `distribution` の機能は、ほかの機能を import しない（`limits.ts` は `RateLimitRule` の形を書き写している）。診断ビルダーの公開の判定は入口（app）で組み合わせる。機能の import の循環（`features-in-cycles`）に入れないため
  - キャンペーンの更新（`updateCampaign`）は、送られた項目だけを書く。`expiresAt` のない更新（名前の変更・停止と再開）は期限を変えず、`null` を送ったときだけ消す（#610）。入口が期限を見るので、期限を消してしまうと、期限の切れた QR がまた転送する
  - 行き先の判定は1つの関数（#692・#695、2026-10-25）：入口の転送先の判定を `openCampaignDestination`（開いているキャンペーン）に移し、QR キャンペーンの画面（`distribution.listCampaigns` の `destination`）は、停止中・期限切れも理由に入れる `campaignDestination`（`isCampaignOpen` と `openCampaignDestination` を使う）で出す。入口と画面で別々に判定を書かない
  - 画面は行き先（AX 診断・`/d/<slug>`・行き先なし）と、行き先なしの理由（停止中・期限切れ・診断を選んでいない（AX の組織以外）・選んだ診断が公開されていない）をすべて、どうすればよいかと一緒に出す。期限切れはスイッチがオンでも期限切れと出す。判定はサーバーで、組織（`ctx.organization`）のキャンペーンと診断だけを読み、診断はキャンペーンの数によらず1回のクエリ（`servedCampaignDiagnoses`）
  - `servedCampaignDiagnoses` は `findPublicDiagnosis` の規則（`published`・同じ組織の現行の版・ほかに同じ slug を公開している診断がない）を distribution の中で書き写したもの（上の import の決まりのため）。食い違わないことは実 DB のテスト（`test/unit/integration/qr-campaign-destination.db.test.ts`）で確かめる。ほかの組織の診断は、slug がぶつかっているかだけを見る（`/d/<slug>` が誰にでも見せていること）
  - AX 診断の組織の比べ方は1つ（#698、2026-10-25）：`resolveDiagnosisOrganizationId()` の本体を基盤（`lib/multi-tenant/helpers/diagnosis-organization.ts`）に移し、id を小文字で返す。組織との比べ方は `isDiagnosisOrganization` だけ（入口・QR キャンペーンの画面・相談申込の営業への通知・代行会社リンクの画面）。機能は今までどおり `lib/features/diagnostics/organization.ts`（再 export）から読み、distribution は基盤から読む（ほかの機能を import しない決まりは変わらない）
  - 期限は画面から付ける・延ばす・消せる（#695、2026-10-25。作者の判断で、オーナー未確認。PR で確認する）：作成のフォームの欄と、キャンペーンごとの編集。編集は `updateCampaign` に `expiresAt` だけを送り（消すときは `null`）、権限は `updateCampaign` と同じ（設定を更新できる人。ほかの人には編集を出さない）。入力は日本時間の日で、その日の終わり（23:59:59.999 JST）を保存する（`lib/features/distribution/campaign-expiry.ts`）。今日（日本時間）より前の日は、作成と編集のどちらでも受け付けない（`expiryOfChosenDay`。日の欄の `min` も今日。保存した時点から閉じ、催しの最中に延ばすつもりで前の年などを選ぶと会場の QR が止まるため。止めるのはスイッチで行う。2026-10-25 の読み取り専用のレビューの nit）。画面の確かめはブラウザの時計で、API の検証（`z.string().datetime()`、送らなければ変えない #610）は変えていない（API からは過去の期限も付けられる）。日本時間の日はブラウザでも求めるので、`formatToParts` で年・月・日を取り出して組み立てる（`en-CA` の形に頼らない）
  - キャンペーンの utm_medium は一覧から選ぶ（#788、2026-10-26 のオーナーの判断。#788 のコメント）。流入元（`INFLOW_SOURCES`）には足さず、今の値に寄せる。流入元の値・分析の画面・リードのフォーム・書き出しは変えない
    - 一覧（`QR_CAMPAIGN_MEDIUMS`、`lib/features/distribution/types.ts`）と流入元：セミナー・ウェビナー `seminar` → `seminar`、展示会 `exhibition` → `seminar`、DM（郵送・個別の配布物）`direct_mail` → `advertising`。文言は `settings.qrCampaigns.medium`（ja・en）
    - 当てはめは `MEDIUM_TO_INFLOW`（`lib/features/diagnostics/tracking.ts`）。一覧の値が表に無いと型チェックが止める（一覧に足すときは、表と文言も足す）。作成のフォームは、選んだ値の流入元を一覧の下に出す（回答と同じ `inferInflowSource` で求める）
    - 既定は `seminar`（作者の判断。一覧の最初で、展示会も同じ流入元）。フォームと API（`createQRCampaignSchema` の既定）の両方。`offline` は既定から外し、表にも足さない（何を配ったか分からないので、流入元は未設定のまま）
    - API は一覧の外の値も受ける（50文字まで、#788 の前と同じ）。作成済みのキャンペーンの値（`offline`・手で打った値）は書き換えず、入口もそのまま渡す。本番の QR キャンペーンは0件（2026-10-26）。`qr_campaigns.utm_medium` の列の既定（`offline`）は残す（作成は必ず値を書くので使われない。変えるにはマイグレーションが要る）
    - キャンペーンの medium を変える画面と API はない（更新は名前・説明・有効・期限だけ）。変えるときは作り直す
- **却下案**:
  - `/d/[slug]` で slug が見つからないときに短縮コードを探す（ぶつかりが残り、どちらを開くかが行の有無で変わる）
  - 保存済みの `tracking_url` を本番で書き換える（読み取りで作れば要らない。本番の書き込みに承認が要る）
  - `[locale]` の下のページで転送する（上の理由）
  - QR の URL から UTM を外す（今の画面と同じ見え方を残した。入口は URL の UTM を使わない）
  - 展示会と DM の流入元を `INFLOW_SOURCES` に足す（#788。オーナーが今の値に寄せると決めた。足すとリード一覧・絞り込み・分析・書き出しの文言まで変わり、10/29 の公開の前に入れられない）
  - DM の medium を `dm` にする（#788。作者の判断。`dm` はメールや SNS のメッセージの意味でもほかのキャンペーンが使い、今は流入元を決めない medium。広告に当てると、それらまで広告になる）
- **既知の限界**:
  - #503 より前にダウンロードした QR の画像（`/d/<コード>`）は 404 のまま。画面から Download QR で作り直す。停止中・期限切れのコードを読んだ人への案内のページはない（本文は `Not Found`）
  - #120 で `diagnosis_id` を設定できるようになるまで、AX の組織以外のキャンペーンの QR はどれも 404 になる（2026-10-25 のオーナーの判断の1）。キャンペーンの画面には、#692 から「読み取っても開きません（診断を選んでいない）」と出る。AX の組織が設定されていないときも、画面は同じ理由を出す（設定の誤りは入口の `console.error` だけで知らせる）
  - 画面の判定は `findPublicDiagnosis` の slug の形の検査（`diagnosisSlugSchema`）をしない（distribution から読めない）。ビルダーが保存する slug は作成のときに検査しているので、形の違う slug が DB にあるときだけ、画面と入口が食い違う。行き先を出すのは一覧だけで、詳細（`getCampaign`）は返さない（詳細の画面がない）
  - `qr_campaigns.diagnosis_id` は診断の削除で null になる（`onDelete: 'set null'`）。削除できるのは公開したことのない下書きだけで、下書きのあいだは 404。削除の後は「`diagnosis_id` のないキャンペーン」になり、AX の組織のキャンペーンなら AX 診断へ送る
  - proxy のメモリの制限はインスタンスごとなので、インスタンスが増えると、1分200回より多く通る。インスタンスとコードをまたいだアドレスごとの上限は、DB の制限（10分200回）だけ
  - RLS（#51）：入口はログインなしで、グローバルの `db` から `qr_campaigns`・`diagnoses`（`findPublicDiagnosis` と同じ）・`public_rate_limits` を組織で絞らずに読む。組織は行から取る。`qr_campaigns` の RLS は無効のまま。RLS を掛けるときは、この入口を公開の読み取りとして扱う（ポリシーか専用の接続）。掛けただけだと、すべての QR が 404 になる（閉じる側に倒れる）。公開の診断の送信も、ログインなしで `qr_campaigns` の `completion_count` を書く（#700。組織は回答の組織で絞る）。RLS を掛けるときは、この書き込みも公開の書き込みとして扱う。掛けただけだと、この UPDATE が0行になるか失敗する。0行なら数が黙って止まる（知らせはない）。失敗なら数だけが止まり、回答とリードは保存される（savepoint、上の「数え損ねてもリードは落とさない」。`reportServerError` で知らせる）。#51 の RLS の材料のコメントにも足した（2026-10-25）
  - 比べ方を1つにした（#698）ことで、`resolveDiagnosisOrganizationId()` は id を小文字で返す。本番の env（`AX_DIAGNOSIS_ORGANIZATION_ID` / `DEFAULT_ORGANIZATION_ID`）の uuid が大文字なら、その id を鍵にしている数が、デプロイの日だけ数え直しになる：運営のページの訪問の `visitorHashOf`（HMAC の入力に組織の id が入る。その日のユニーク訪問がデプロイの前と後で2回数えられる）と1日の上限のキー（`${organizationId}:${day}`、`lib/features/site-visits/record.ts`）、AX 診断の通知の組織ごとの上限（`checkNotificationLimits`、`app/api/diagnostics/ax-migration/route.ts` から env の id で数える）。影響は1日分の計測と上限のずれだけ。DB に保存する組織の id は uuid の列なので変わらない（2026-10-25 の読み取り専用のレビューの nit。本番の値が大文字かは確かめていない）
  - `diagnosis_id` がほかの組織の診断を指すキャンペーンも、画面の理由は「選んだ診断が公開されていない」になる（公開しても開かない）。今は `createCampaign`・`updateCampaign` で `diagnosis_id` を書けないので、DB のデータが食い違ったときだけ起きる。入口が 404 を返すことは変わらない。#120 で選べるようにするときは、その診断が `ctx.organization` のものかをサーバーで確かめる（#120 の受け入れ基準に足した。2026-10-25 の読み取り専用のレビューの nit）
  - #610 の修正より前に、本番の停止と再開で期限が消えたキャンペーンは戻らない（どの行の期限が消えたかの記録はない）。期限は API で付けたときだけだったので、当たる行は少ない。#695 から、画面に期限が出て、付け直せる
  - スキャンからリードまでは、回答が持つコードで数える（#700）。次の限界がある
    - URL のコードを書き換えると、同じ組織のほかのキャンペーンに数えられる（オーナーが受け入れた。数が狂うだけで、データは漏れない。ほかの組織のキャンペーンには数えない）
    - 数えるのは転送先のアドレスのコードなので、スキャンとして記録されなかった来訪（キャンペーンの1日の上限を超えた日・ボットと判定した UA）、アドレスを人に渡したとき、ブックマークから後日回答したときも数える。リードの数がスキャンの数を超えると、新規リード率は100%を超える（上限で切らない。食い違いを隠さないため。作者の判断を、2026-10-26 にオーナーが確かめた③）。そのときは画面に理由の注記を出す。スキャンが0件のときは、リードがあっても率は「—」と出す（`campaignNewLeadRate` が `null`。算出できないことが分かるように。2026-10-26 のオーナーの判断④。それまでは0%と出していた）
    - 数は増える一方で、リードを削除しても減らない（`diagnostic_submissions.lead_id` は SET NULL）。偽のリード（Turnstile と回数制限の範囲で、別々のメールアドレスで送られたもの）を営業が消しても、数は残る。運営が本番で QR の流れを試験送信した分も、`is_test` ではないので本物のキャンペーンに数える。数え直すときは、`diagnostic_submissions` を組織で絞り、`lead_created = true`・`is_test = false`・`tracking->>'qr' = <コード>` で数える（削除したリードを除くなら `lead_id is not null` も足す。数え損ねた回答（上の savepoint）は、数え直しには入る）（2026-10-25 の読み取り専用のレビューの nit）
    - 内訳（2026-10-26）の限界
      - 既存リードの再回答は、回答が `lead_created = false`（同じ組織に同じメールアドレスのリードがあった）かで決める。そのため、前に回答したことのないリードの初めての回答（CSV の取り込み・営業経由・資料請求で作ったリード）と、このコードで新規リードになった人が、同じアドレスのまま送り直した回答や、結果の画面から別のシステムを診断した回答も（そのときにはリードがあったので）再回答に入る。画面の説明に書いた。展示会で名刺を先に取り込むと、その来場者は新規リードではなくここに入る（運用のルールにするかはオーナーの確認待ち）
      - 関心あり・相談申込はリードの今の状態で数えるので、消したリードは入らず、営業が MQL の日付を付けた・外したことも反映される。再回答は回答の件数なので、リードを消しても減らない。数え損ねた新規リード（上の savepoint）は、新規リードの数には入らないが、内訳には入る
      - キャンペーンの作成日との比較（`diagnostic_submissions.created_at >= qr_campaigns.created_at`）は、どちらもタイムゾーンのない列どうしの比較。回答の側は JS の Date（drizzle が UTC で送る）、キャンペーンの側は `defaultNow()`（DB のセッションのタイムゾーン）で書くので、DB のタイムゾーンが UTC（Supabase と CI）であることを前提にしている。UTC でなくなると、作成直後の回答が内訳から落ちうる（2026-10-26 の architecture のレビューの nit）
      - `tracking->>'qr'` に索引はない。1回のクエリが組織の回答を読み（`diagnostic_submissions` の組織の索引）、キャンペーンのコードと作成日で絞る。回答が増えて遅くなったら、式の索引（`organization_id, (tracking->>'qr')`）を足す（スキーマの変更なので、本番に当ててからマージする）
    - コードは転送された先のページの中だけで持つ。AX のほかのページへ移ってから診断に戻ると（ページ間のリンクが運ぶのは utm_*・ref・agency・from だけ）、UTM は残るがコードはなく、数えない
    - #700 より前の回答とリードは数えていない（本番のキャンペーンは0件で、数え直すものはない）。そのため画面の「{作成日}（作成日）からの累計」は、#700 の公開の後に作ったキャンペーンについて正しい。公開より前に作って読み取られたキャンペーンがあると、読み取りは作成日から、新規リードと内訳は公開日からになり、率が低く出る（2026-10-26 の ui-ux のレビュー。2026-10-26 の時点で本番のキャンペーンは0件なので、計測開始日は画面に出していない）
  - `qr_scans` に `campaign_id`・`lead_id`・`organization_id` の索引がない。集計とキャンペーンの削除（CASCADE）は表全体を読み、リードの削除（`lead_id` の SET NULL）と組織の削除も、どの組織の操作でも表全体を読む。記録はキャンペーンごとに1日2,000件までだが、保存の期間はなく、行は増え続ける。索引は #702（スキーマの変更なので、本番に適用してからマージする）。記録の文に `lock_timeout` はなく、キャンペーンの行が長くロックされると（索引のない CASCADE など）、応答の後の書き込みが接続を持ったまま待つ（#702 の索引でほぼなくなる）。#700 から、そのキャンペーンのコードで新しいリードを作る回答の送信も、数える文で待つ。待つのは `QR_COMPLETION_LOCK_TIMEOUT`（3秒）までで、超えたら数えずに回答とリードを保存する（キャンペーンの削除の CASCADE が先に終われば、行がないので数えずに進む）
  - `qr_scans` の保存期間は決めていない（今は無期限。訪問の生の記録は90日の案）。今の列では個人に結び付かない（件数の少ない日は、日とコードで回答と突き合わせられる。上の「プライバシー」）。#700 ではスキャンの行とリードを結ばなかったので、この限界は変わらない。あとで結ぶなら、保存期間と削除を先に決める（法務・情報システム部門）
  - UA の判定は `/api/collect` と同じなので、限界も同じ：`isBot` の `bot` は部分一致で、端末名に bot を含む人のスキャン（例：CUBOT の端末。推測）を落とす。iPadOS の Safari は既定でデスクトップの UA を送るので `desktop` として数える。ブラウザの UA を名乗るメールのリンク検査などは、人のスキャンとして数える。数の精度の問題で、守りの問題ではない
  - #41 より前のスキャンは記録されていない（本番の `scan_count` は0から数え始める）
