---
id: 2026-10-24-qr-short-code-entry
date: 2026-10-24
category: Security
title: "QR キャンペーンの入口は /q/<短縮コード>。転送先は DB の値とアプリのルートだけから作る（#503）"
status: active
superseded_by: []
issues: [503, 41, 120, 610, 663, 692, 700, 702]
paths: ["app/q/**", "lib/features/distribution/short-code-entry.ts", "lib/features/distribution/scans.ts", "lib/features/distribution/limits.ts", "lib/features/distribution/qr-code.ts", "lib/features/distribution/router.ts", "lib/middleware/rate-limit.ts", "lib/features/diagnostics/organization.ts"]
---

### [Security] QR キャンペーンの入口は /q/<短縮コード>。転送先は DB の値とアプリのルートだけから作る（#503）
- **日付**: 2026-10-24
- **決定**: QR キャンペーンの画面は使い続け、QR の URL を直す（オーナー判断、#503 のコメント）。QR の URL は `/q/<短縮コード>`。入口は `[locale]` の外の Route Handler（`app/q/[code]/route.ts`）で、開いているキャンペーンを短縮コード（大文字と小文字を区別）で探し、診断へ 307 で転送する
  - 行き先（2026-10-25 に #663 で変えた。下の「オーナーの判断」）
    - `qr_campaigns.diagnosis_id` があるキャンペーン：その診断がキャンペーンと同じ組織にあり、`/d/<slug>` がその診断を出すとき（`findPublicDiagnosis` が同じ id を返すとき）は `/ja/d/<slug>`。出さないとき（停止中・アーカイブ・下書き・ほかの組織と slug がぶつかっている・ほかの組織の診断）は 404。AX 診断へは送らない
    - `diagnosis_id` がないキャンペーン：キャンペーンの組織が `resolveDiagnosisOrganizationId()`（`lib/features/diagnostics/organization.ts`。AX 診断の回答をリードにする組織）と同じときだけ AX 診断（`/ja/ax-diagnosis`。`/diagnostic/[slug]` と同じ）。ほかの組織のキャンペーンと、その組織が設定されていないときは 404（設定されていないことは、インスタンスごとに1回 `console.error` に出す。配った QR が黙って止まらないように）
  - UTM はキャンペーンの列（utm_source・utm_medium・utm_campaign・utm_content）を付ける。言語は既定の `ja`
  - 停止中・期限切れ・存在しないコードは 404（本文は `Not Found` だけ）。どの応答も `Cache-Control: no-store` と `X-Robots-Tag: noindex, nofollow`
  - 回数制限の 429 は、入口（DB の制限）でも proxy（メモリの制限）でも、日本語1行の text/plain（`QR_ENTRY_TOO_MANY_REQUESTS_TEXT`）。QR を読んだスマートフォンは本文をそのまま表示するので JSON にしない。入口にはロケールがなく、転送先も `/ja/` なので日本語だけ
  - 1回の読み取りは `maxDuration = 15` 秒まで（`vercel.json` の30秒は `app/api/**` だけに掛かる。DB のクライアントには SQL の実行時間の上限がない）。接続の待ち（10秒、`lib/db/client.ts`）とその後の通知が収まる長さ
  - 保存済みの `qr_campaigns.tracking_url`（#503 より前は `/d/<コード>`）は読まない。一覧の Copy URL・詳細・Download QR は、短縮コードと UTM の列から毎回 URL を作る（本番の行を書き換えない）。新しいキャンペーンは `/q/` の URL を保存する
  - 使われていなかった `distribution.generateQRCode`（テンプレートの id で `/d/` を作っていた）は外した
- **オーナーの判断（2026-10-25、#663 のコメント）**: #633 のレビューで出た3つを、オーナーが決めた
  1. ほかの組織のキャンペーン：`campaign.organizationId` が `resolveDiagnosisOrganizationId()` と同じときだけ AX 診断へ送り、ほかの組織のキャンペーンは 404 にする（その組織の診断を `diagnosis_id` で設定できるようになる #120 まで）。ほかの組織の来訪者の個人情報（氏名・会社・メールアドレス・キャンペーンの UTM）を、運営の組織がリードと訪問の記録で受け取る経路をなくすため
  2. 回数制限：QR を配る催しの想定の最大人数は100人。その2倍で、DB の制限（アドレスごと）を10分に200回、proxy のメモリの制限（アドレスとコードごと）を1分に200回にする。一斉の読み取りは開始の数分に集まるので、人数より少ない上限は会場の Wi-Fi（1つの NAT のアドレス）で必ず当たる。上限は1つのアドレスの検索の回数を抑えるためのもの（コードは 55^8 通り）で、上げても守りはほとんど落ちない
  3. 公開されていない診断：`diagnosis_id` があるのに `/d/<slug>` がその診断を出さないとき（停止中・アーカイブ・slug の衝突）は 404 にする。案内と違う診断に回答させない。診断の停止は作った人の意図した操作なので、QR も止まるほうが期待に合う
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
    - UA の判定（`isBot`・`deviceOf`、`lib/features/site-visits/request.ts`）は入口（app）で組み合わせ、`distribution` からは読まない（下の import の決まり）。UA は先頭の512文字だけを渡す（`deviceOf` のタブレットの正規表現は UA の長さの2乗の時間がかかり、入口では 307 を返す前に動くため）
    - `getCampaignStats` は、合計を `scan_count`、端末の内訳と転換率を `qr_scans` の集計（DB で数える。全行を読まない）から返す。直近の10件は id・端末・日（`scannedOn`、日本時間の `YYYY-MM-DD` の文字列）・converted だけを返す。日を Date で返すと、タイムゾーンのない列の0時が UTC として読まれ、画面では日本時間の9:00に見えるため
  - `distribution` の機能は、ほかの機能を import しない（`limits.ts` は `RateLimitRule` の形を書き写している）。診断ビルダーの公開の判定は入口（app）で組み合わせる。機能の import の循環（`features-in-cycles`）に入れないため
  - キャンペーンの更新（`updateCampaign`）は、送られた項目だけを書く。`expiresAt` のない更新（名前の変更・停止と再開）は期限を変えず、`null` を送ったときだけ消す（#610）。入口が期限を見るので、期限を消してしまうと、期限の切れた QR がまた転送する
- **却下案**:
  - `/d/[slug]` で slug が見つからないときに短縮コードを探す（ぶつかりが残り、どちらを開くかが行の有無で変わる）
  - 保存済みの `tracking_url` を本番で書き換える（読み取りで作れば要らない。本番の書き込みに承認が要る）
  - `[locale]` の下のページで転送する（上の理由）
  - QR の URL から UTM を外す（今の画面と同じ見え方を残した。入口は URL の UTM を使わない）
- **既知の限界**:
  - #503 より前にダウンロードした QR の画像（`/d/<コード>`）は 404 のまま。画面から Download QR で作り直す。停止中・期限切れのコードを読んだ人への案内のページはない（本文は `Not Found`）
  - #120 で `diagnosis_id` を設定できるようになるまで、AX の組織以外のキャンペーンの QR はどれも 404 になる（2026-10-25 のオーナーの判断の1）。キャンペーンの画面には、そのことが出ない（#692）
  - `qr_campaigns.diagnosis_id` は診断の削除で null になる（`onDelete: 'set null'`）。削除できるのは公開したことのない下書きだけで、下書きのあいだは 404。削除の後は「`diagnosis_id` のないキャンペーン」になり、AX の組織のキャンペーンなら AX 診断へ送る
  - proxy のメモリの制限はインスタンスごとなので、インスタンスが増えると、1分200回より多く通る。インスタンスとコードをまたいだアドレスごとの上限は、DB の制限（10分200回）だけ
  - RLS（#51）：入口はログインなしで、グローバルの `db` から `qr_campaigns`・`diagnoses`（`findPublicDiagnosis` と同じ）・`public_rate_limits` を組織で絞らずに読む。組織は行から取る。`qr_campaigns` の RLS は無効のまま。RLS を掛けるときは、この入口を公開の読み取りとして扱う（ポリシーか専用の接続）。掛けただけだと、すべての QR が 404 になる（閉じる側に倒れる）
  - #610 の修正より前に、本番の停止と再開で期限が消えたキャンペーンは戻らない（どの行の期限が消えたかの記録はない）。画面には期限が出ず、期限を付ける・延ばす・消す入力もない（#695）。期限は API で付けたときだけなので、当たる行は少ない
  - スキャンからリードまで（`completion_count`・`qr_scans.converted`・`lead_id`）はまだ数えない（#700）。`getCampaignStats` の転換率は0のまま
  - `qr_scans` に `campaign_id`・`lead_id`・`organization_id` の索引がない。集計とキャンペーンの削除（CASCADE）は表全体を読み、リードの削除（`lead_id` の SET NULL）と組織の削除も、どの組織の操作でも表全体を読む。記録はキャンペーンごとに1日2,000件までだが、保存の期間はなく、行は増え続ける。索引は #702（スキーマの変更なので、本番に適用してからマージする）。記録の文に `lock_timeout` はなく、キャンペーンの行が長くロックされると（索引のない CASCADE など）、応答の後の書き込みが接続を持ったまま待つ（#702 の索引でほぼなくなる）
  - `qr_scans` の保存期間は決めていない（今は無期限。訪問の生の記録は90日の案）。今の列では個人に結び付かないが、#700 でスキャンの行とリードを結ぶなら、保存期間と削除を決める（法務・情報システム部門）
  - `totalConversions` は `completion_count` から、`conversionRate` は `qr_scans.converted` から取る。どちらも0のままだが、#700 で片方だけを書くと食い違うので、#700 で出どころをそろえる
  - UA の判定は `/api/collect` と同じなので、限界も同じ：`isBot` の `bot` は部分一致で、端末名に bot を含む人のスキャン（例：CUBOT の端末。推測）を落とす。iPadOS の Safari は既定でデスクトップの UA を送るので `desktop` として数える。ブラウザの UA を名乗るメールのリンク検査などは、人のスキャンとして数える。数の精度の問題で、守りの問題ではない
  - #41 より前のスキャンは記録されていない（本番の `scan_count` は0から数え始める）
