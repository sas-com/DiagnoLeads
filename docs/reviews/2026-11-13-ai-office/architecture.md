> **これは記録です。** `architecture-specialist`（AI）が 2026年11月13日に読み取り専用で行ったレビューの報告を、そのまま残しています。
> 対象：PR #1105 の部屋・カスタマイズの作りと、PR #1136 の 3D の検証。見たコミット：`111c8695`（PR #1105）・`38a36b2a`（PR #1136）。
> 行番号と指摘は、その時点のコードのものです。直したもの・残っているものは [README.md](./README.md) を見てください。
> 【推測】と書かれた項目は、実行して確かめたものではありません。

# 総評

- PR #1105 に、アーキテクチャの面でマージを止める欠陥は見つかりませんでした。組織の絞り込み・依存の向き・追加だけのスキーマは守られています。残る条件は、本番への 0039 の適用とオーナーの承認という手続きだけです。
- PR #1136（3D の検証）は、今の形のまま main に入れると困る点が3つあります（PR の本文も「このままマージしない」としており、その判断は妥当です）。
- 部屋の型は「純粋な関数＋部屋ごとの画面＋既存 API を直接呼ぶ」という骨格は保てます。ただし3部屋目（営業フロア）の前に、部屋の契約と登録表、入れ物の場面ごとの分割を入れないと、1,220 行の入れ物と `office-rooms.ts` が並行セッションの衝突点になります。

読み取りだけで確かめました。テスト・ビルド・`db:generate`・`arch:check` は実行していません。以下、【確認】はコードで読んだ事実、【推測】は実行していない見立てです。パスの起点は ``、`office-*.ts(x)` は `components/features/ai-employees/` の下です。

# 1. マージを止めるべき指摘（PR #1136 を今の形で main に入れる場合だけ。PR #1105 には無し）

| # | 場所 | 何が問題か | どう直すか |
|---|---|---|---|
| S1 | `office-immersive.tsx:299-301`、`office-rooms.ts:31-39` | 【確認】フロアの `3` キーが 3D の切り替えに使われています。決定 `2026-11-13-office-is-the-base` は「3＝営業フロア」を固定しており、`3` の判定は `roomOfKey` より前にあるので、営業フロアを足すと部屋の鍵が黙って効きません。`office-rooms.test.ts:45-47` の「カメラの鍵と重ならない」検査に `3` は入っていません。 | 3D の切り替えを数字以外（例：`V`）に変えます。フロアの鍵を1つの純粋な関数（下の `office-stage.ts` の `worldKeyAction`）に集め、「部屋の鍵 1〜5 とほかの操作が重ならない」をテストで固定します。 |
| S2 | `office-immersive.tsx:77`、`:499-509` | 【確認】`OfficeCanvas3D` の周りにエラー境界も `loading` もありません（`components/features/ai-employees` に ErrorBoundary は0件）。【推測】WebGL が作れない端末や、デプロイ後に古いチャンクが 404 になる場合（インストールしたアプリは開きっぱなしになりやすい）、例外が `app/[locale]/error.tsx` まで上がり、オフィス全体がエラー画面になります。決定の「2D を控えに残す」が実際には働きません。読み込み中は 2D を先に隠す（`:475`）ので、916 KB が届くまで床が空になります。 | 3D を小さなエラー境界で包み、失敗したら `threeD` を false に戻して 2D を出し、部屋の中の文で伝えます。2D を隠すのは Canvas の最初の描画のあとにします。 |
| S3 | `office-immersive.tsx:80-81`、`:150-153`、`:406-415`、`:716-775` | 【確認】検証用のパネル（状態と出来事を偽る）と FPS の表示が、本番の入れ物の state と JSX に入っています。`onFps={setFps}` は毎秒、1,220 行の部品全体を描き直します。main へのマージは本番デプロイなので、利用組織に「作業が成功した」を偽れる操作が出ます（注記はありますが、「していないことをしたように見せない」の決まりと近い位置です）。 | 検証のまま main に入れません。本実装では、パネルと FPS を消し、`events` を実際の出来事（`lastRun` の変化・採用・再開）から作る純粋な関数に替えます。それまでに PR #1136 の中で、パネルを `office-3d/office-3d-trial.tsx` に出し、入れ物の差分を 20 行ほどにしておくと、あとの入れ物の分割と衝突しません。 |

# 2. 直したほうがよい指摘（費用対効果の高い順）

| # | 重要度 | 場所 | 何が問題か（いつ困るか） | 最小の直し方 |
|---|---|---|---|---|
| M1 | 高 | `lib/features/ai-employees/types/profile.ts:81-90`、`:204-216`、`test/unit/features/ai-employees/profile.test.ts:47-58` | 【確認】`robotLookSchema` は全キー必須で `.strict()`、読み取りは部分（look 全体）ごとの `safeParse` です。選択肢を1つ消すと、その値を持つ AI社員の見た目6項目がすべて既定に戻ります。**見た目の項目を1つ足す（例：脚）と、保存済みのすべての組織のすべての look が「キー不足」で不正になり、全員が既定の姿に戻ります。** 次に保存すると上書きされ、元に戻せません。「項目を足すたびにマイグレーションを作らない」の決定と、実際の振る舞いが合っていません。`stats` も同じです（能力を1つ足す、合計の上限を下げる）。 | look と stats を項目ごとに読みます（有効な項目だけ残し、欠けた・無効な項目だけ既定）。10 行ほどです。テスト `:47` の期待値を「head だけ既定、ほかは残る」に変えます。本番にデータができる前の今が無料です。書き込みの厳格さは今のままで構いません。 |
| M2 | 高 | `office-immersive.tsx:314-317`、`:430-437` | 【確認】Esc が部屋の鍵のハンドラに2回届く作りです。`onKeyDown` は room・studio のすべてのキー（Escape も）を `roomKeys` に渡し、`onEscapeKeyDown` も同じハンドラを呼びます。【推測・実行は未確認】今の3つ（ファイルを閉じる・破棄の確認・何もしない）は2回呼ばれても同じ結果なので表に出ません。次の部屋で Esc が「1段戻る」（`setDepth(d => d - 1)` のような更新）になると、2段戻ります。 | `onKeyDown` の先頭で `if (event.key === 'Escape') return;` を足します（Esc は `onEscapeKeyDown` だけが配る）。「Esc は1回だけ届く」を入れ物のテストに1件足します。 |
| M3 | 高 | `office-rooms.ts:26-29`、`office-immersive.tsx:342-345`、`:940-962`、`:147`・`:937` | 【確認】部屋の型が3か所で2部屋専用です。(a) `ROOM_ROLES: Record<OfficeRoom, AiEmployeeRole>` とカメラの `DESK_SEATS[ROOM_ROLES[room]]` は、役割の無い「社長のデスク」（鍵 1）を表せません。(b) 部屋の切り替えが三項演算子で、部屋ごとに props が違います（`onOpenLead`・`onFileOpenChange` と `onBack`・`onOpenNormal`）。(c) `roomFileOpen` は「Esc の表示を隠す」ためだけに、部屋の中の事情を入れ物へ持ち上げています。 | 3部屋目の PR の前に、部屋の契約と登録表を入れます（4. の案）。 |
| M4 | 中 | `office-lead-file.tsx:77-83`、`office-room-due.tsx:86-90` | 【確認】キャッシュを捨てる一覧が、既存の画面からの写しです（`components/features/lead-follow-up/use-record-contact.tsx:37-43`、`task-parts.tsx:139-141` と同じ中身）。連絡や次の行動を出す画面が増えたとき、片方だけ直されて、オフィスで記録したものが通常の表示に出ない（またはその逆）ずれが起きます。部屋が増えるたびに写しが増えます。 | 持ち主の機能の側に、トーストを出さない小さな hook を出し、両方から使います（例：`use-record-contact.tsx` に `useContactRefresh({ organizationId, leadId })`、`task-parts.tsx` に `useTaskRefresh(organizationId)`）。components 同士の読み合いは前例があります（`lead-handoff-sheet.tsx` が `lead-follow-up/task-parts` を読む）。「選択肢で実行する部屋」の型として、決定に1行足す価値があります。 |
| M5 | 中 | `office-rooms.ts`（199 行、全部屋の純粋な関数）、`office-immersive.tsx`（1,220 行） | 【確認】どちらも、部屋を足す PR が必ず触るファイルです。2部屋と顧客ファイルで 199 行なので、6部屋では 500〜600 行になる見込みです【推測】。並行のセッションが別の部屋を同時に作ると、ここで衝突します（CLAUDE.md の「衝突しやすいファイル」と同じ種類）。 | 4. の分け方にします。既存の関数の移動は、`docs/ARCHITECTURE.md` 6節の条件（そのファイルを触る open な PR が0、移動だけの PR）に従い、PR #1105 と #1136 の決着のあとに行います。新しい部屋の関数は、最初から部屋ごとのファイルに書きます。 |
| M6 | 中 | `office-rooms.ts:86,156,181`、`office-studio.tsx:38-41`、`office-immersive.tsx:318-320`／`office-room-leads.tsx:169-176`、`office-lead-file.tsx:124-131`、`office-room-due.tsx:149-156`、`office-studio.tsx:123-130` | 【確認】同じものの写しです。「数字キー → n 番目の選択肢」が5か所、「最新のハンドラを keysRef に入れる」が4か所、選択肢のボタンの並び（`office-room-leads.tsx:224-247`、`office-lead-file.tsx:183-206`、`office-room-due.tsx:197-217`）が3か所。 | `choiceOfKey<T>(key, choices)`（純粋）、`useRoomKeys(keysRef, handler)`、`RoomChoices` の3つを `office-room-parts.tsx` の近くに置きます。3部屋目を作る PR で入れれば、その部屋の行数がそのぶん減ります。 |
| M7 | 中 | `office-room-leads.tsx:202,255`、`office-lead-file.tsx:170,212` | 【確認】`ROOM_FRAME`・`ROOM_BOARD`・`choiceClass`（`office-room-parts.tsx:46-58`）と同じ文字列を、マーケティング室と顧客ファイルは直書きしています（受付とスタジオは共通の定数を使用）。枠を1か所直しても2部屋が取り残されます。 | 定数に置き換えます（見た目は変わりません）。 |
| M8 | 中 | `lib/features/ai-employees/service.ts:227-229`、`api/router.ts:76-90`、決定 `2026-11-13-ai-employee-customization` | 【確認】`workStyle.autonomy`（`ask`／`report`）は今から保存できますが、画面は「今は働きには効きません」と書いています。変更の記録は `updated_at` だけで、誰が変えたかは残りません（`createAuditLog` は `lib/features/audit-logs/service.ts:14` にありますが、ai-employees からは呼んでいません）。#1114 で効かせた日に、「効かない」と書かれた画面で試しに `report` にした組織の AI社員が、確かめずに動き始めます。 | 今は直さず、#1114 に受け入れ基準として書きます：(1) 効かせる前に保存された `autonomy` はそのまま有効にしない（効かせる PR で `ask` に戻すか、キーを変える）。(2) `workStyle` の変更は監査に残す。(3) 能力値の合計の上限をレベルで変えるなら、上限の検査は zod（`profile.ts:132`、定数 12）ではなく service に移す。 |

# 3. あとでよい指摘

| # | 場所 | 内容 | 直し方 |
|---|---|---|---|
| L1 | `office-lead-file.tsx:20`、`office-room-leads.tsx:38`、`office-immersive.tsx:65,145,906`、`office-room-due.tsx:14`、`office-studio.tsx:28` | 【確認】`RoomKeys` 型が顧客ファイルのファイルにあり、取り込み元が2通り（`office-room-leads` の再 export と `office-lead-file`）。スタジオ（部屋ではない）も `roomKeys` を使います。 | 型を契約のファイル（4. の `office-room-contract.ts`）に移し、ref の名前を `stageKeys` にします。 |
| L2 | `office-rooms.ts:75-80`、`office-room-leads.tsx:96-100` | 【確認】`LEAD_REPORT_VIEWS` はテストからしか使われず、実際の3本の件数の問い合わせは直書きです。 | 定数から `useQueries` で作るか、定数を消します。 |
| L3 | `office-room-due.tsx:68,183` | 【確認】`reportRef` は付けているだけで読んでいません。 | 消します。 |
| L4 | `office-lead-file.tsx:23-29`、`office-room-leads.tsx:36`、`office-lead-file.tsx:167` | 【確認】`LEAD_STATUS_COLORS` が `Record<string, string>` で、リードの状態を足しても型で気づけません。MQL の印の数え方が2か所にあります。 | `Record<LeadStatus, string>`（`lib/features/leads/types/pipeline.ts:22`）にし、印の数は1つの関数にします。 |
| L5 | `lib/features/ai-employees/types/roles.ts:11-12,40-43`、`office-rooms.ts:22-29`、`office-map-layout.ts` の `OFFICE_AREAS` | 【確認】「部屋」の語彙が3つあります（`AI_OFFICE_ROOMS`・`OFFICE_AREAS`・`OFFICE_ROOMS`）。`ROOM_ROLES` は役割の定義の `room` の逆引きの写しで、`rolesInRoom`・`AI_OFFICE_ROOMS` はアプリのコードからは使われていません（テストだけ）。 | 部屋の登録表で、役割は `rolesInRoom` から導くか、「両方が合う」テストを1件足します。 |
| L6 | `office-map.tsx:13`、`office-scene.ts:34`、`office-president.ts` の `looksByRole`・`RobotLooks` | 【確認】通常の表示が、出社の画面の規則のファイルから見た目の型を読んでいます。 | 見た目の表を分けるとき（5. の `office-robot-look.ts`）に一緒に移します。 |
| L7 | `office-immersive.tsx:85-88`、`office-rooms.ts:1-10` | 【確認】`ZOOM_MAX` の説明コメントが `NAME_BAND_SHADE` の上に離れています。`office-rooms.ts` は1行目の import がファイルの説明コメントより上にあります。 | 触るついでに直します。 |
| L8 | `office-room-due.tsx:76-80,86-90` | 【確認】受付は上限 200 件を読み、済みにするたびに自分の問い合わせも捨てて 200 件を読み直します。読み直した一覧は順番に使いません（`canEdit`・`today`・残りの件数だけ）。【推測】30 件を片づけると、200 行の読み直しが 30 回です。今の規模では問題になりません。 | 部屋の定数（例：30 件）で読み、超える分は今の「ほかに n 件」で伝えます。朝の報告を同じ型で作るときに合わせます。 |
| L9 | `office-room-leads.tsx:93-100`、`lib/features/leads/api/router.ts:272-328` | 【確認】マーケティング室は `leads.list` を4本呼びます。`httpBatchLink` で HTTP は1回ですが、DB では4回の所属確認と、件数だけの3本にも `findMany`（最新の商談・MQL・タグの付いた1行）が走ります。最初の表示（未着手）は、ボードの `total` と件数の1本が同じ値です。`staleTime` が5分なので、部屋を開け閉めしても増えません。今は問題になりません。 | 今は直しません。**直す時点**：決定にある「部屋の札に、その部屋の今の数字を出す」をフロアで実装するときです（フロアを開くたびに 5〜6 部屋 × 数本になります）。そのときは、部屋ごとに API を足さず、フロア用の件数を1本にまとめます。 |
| L10 | `office-screen.tsx:42-45`、`desk-sheet.tsx:50` | 【確認】`aiEmployees.office` を 60 秒ごとに読みます（3クエリと所属確認）。今はどの役割にも仕事が無く（`works.ts` の `issue` がすべて番号）、状態は利用者の操作でしか変わりません。インストールしたアプリは開きっぱなしになりやすく、1つの窓で1日 480 回ほどです【推測】。 | 仕事のある役割があるときだけ定期的に読みます（`AI_EMPLOYEE_ROLES.some(roleHasWork)`）。 |
| L11 | `office-3d/office-canvas-3d.tsx:36-45`、`office-scene.ts:76-85`、`office-3d/robot-3d.tsx:17-20`、`office-robot.ts:169,352,360` | 【確認】共有できているもの：床の配置（`AREA_RECTS`・`ROLE_DESKS`・`TRAINING_DESKS`・`CHARGING_PADS`・`spotOf`）、本体と差し色の表、役割の装備、状態の灯りの色。共有できていないもの：床の色（2D は `FLOOR_COLOURS`、3D は昼夜の `AREA_COLORS` を別に持つ）、バイザー・目・暗い部品の色（両方に直書き）、カメラの「幅 29・高さ 19」（`office-canvas-3d.tsx:225-226`。床の大きさから導いていないので、社長のデスクの区画を足すとずれます）。 | 本実装に進むと決まってから、5. の案で直します。検証の間は直しません。 |
| L12 | `office-3d/robot-3d.tsx:251-266`（頭）、`:273-283`（目）、`test/unit/components/ai-employees/office-3d.test.ts` | 【確認】2D には「選択肢ごとに絵が変わる」テストがあります（`office-robot-look.test.ts:52-58`）が、3D にはありません。3D の頭は三項演算子の最後が箱で、カタログに頭を足すと黙って箱になります。 | 本実装で、`Record<RobotHead, …>` のような網羅した表にして、型で落とします（WebGL のテストは要りません）。 |
| L13 | `drizzle/0039_ai_employees.sql` の最後の2行 | 【確認】RLS を有効にする2行は手で足したもので（従来の表と同じやり方。例：`0033_sales_targets.sql`）、作り直すと消えます。`profile.test.ts:159` が検出します。【推測】古い 0039 を流した手元の DB では、新しい `when` の 0039 がもう一度流れ、CREATE TABLE で止まります（`db:migrate --check` が警告する場合です）。 | 作り直すたびに2行を足し直します。古い 0039 を流した手元の DB は、2つの表を消してから流します。 |

# 4. 分け方の案

## 4.1 部屋の型（3部屋目の PR で入れる。新しいファイルだけで始められます）

| ファイル | 責務 |
|---|---|
| `office-room-contract.ts`（新規・型だけ） | `RoomKeys`、`OfficeRoomProps`（全部屋で同じ props：`organizationId`、`guide`（その部屋の AI社員：役割・状態・名前・見た目。社長のデスクは `null`）、`keysRef`、`onBack`（フロアへ）、`onLeaveOffice`（通常の表示へ））。`onFileOpenChange` はやめ、Esc の表示は部屋が自分の枠の中に出す |
| `office-rooms.ts`（今のファイルを細くする） | 部屋の登録表だけ：`OFFICE_ROOMS`、部屋ごとの `{ key, role: AiEmployeeRole \| null, anchor: FloorPoint }`（カメラが寄る場所。役割があれば席から導く）、`roomOfKey`、`roomGuide`、`choiceOfKey`、`nextRow` |
| `office-room-registry.tsx`（新規） | `ROOM_VIEWS: Record<OfficeRoom, ComponentType<OfficeRoomProps>>`。部屋を `OFFICE_ROOMS` に足して画面を登録し忘れると、型で落ちます。入れ物は `const Room = ROOM_VIEWS[room]` で描くだけ（三項演算子が消えます）。部屋が重くなったら、ここで部屋ごとに `next/dynamic` にできます |
| `office-room-parts.tsx`（今のファイルに足す） | `RoomGuideHeader`・`ROOM_FRAME`・`ROOM_BOARD`・`choiceClass`（今ある）＋ `RoomChoices`（数字の鍵の付いた選択肢の並び）＋ `useRoomKeys(keysRef, handler)` |
| `rooms/leads-board.ts`・`rooms/lead-file.ts`・`rooms/due-queue.ts`（今の `office-rooms.ts` の 62-199 行を移す。移動は 6節の条件で） | 部屋ごとの純粋な関数（ボードの表示・入力、ファイルの選択肢、期限の列の選択肢と状態） |
| `rooms/<部屋>.ts` と `office-room-<部屋>.tsx`（これから足す部屋） | 営業フロア・開発室・社長のデスクは、最初からこの2ファイル＋登録表への1行で足します。記録とキャッシュの更新は、持ち主の機能の hook（M4）を呼びます |

期待効果：部屋を足す PR が触る共有のファイルが、登録表の2行と文言だけになります。想定リスク：契約を先に固めすぎると、型に合わない部屋（社長のデスク＝「今日」）が出ます。`guide: null` を最初から許し、props は上の5つより増やさないでください。

## 4.2 入れ物 `office-immersive.tsx` の分割（PR #1105 と #1136 の決着のあと、移動だけの PR で）

| ファイル | 責務 | 今の行 |
|---|---|---|
| `office-immersive.tsx`（殻。250 行ほど） | Radix の dialog、`stage`・`room`・`selected` の state、Esc と戻る、鍵の配分（world は `worldKeyAction`、ほかは `stageKeys.current`）、床の層（`SceneDrawing`＋カメラの transform、3D の切り替え）、場面の部品を1つ描く | 112-158、225-259、283-325、418-514 |
| `office-stage.ts`（新規・純粋） | `Stage` 型、`stepBack(stage)`、`worldKeyAction(key, { canCustomize })`（話す・寄る・引く・戻す・カスタマイズ・部屋・3D）。鍵の衝突をテストで固定（S1） | 71、255-259、286-313 |
| `office-camera.ts`（純粋）と `use-office-camera.ts`（hook） | 純粋：場面ごとの目標（home／席／部屋の anchor）から `scale` と `camera` を出す。hook：`size`・`zoom`・`pan`・ドラッグ・ホイール | 83-94、136-139、327-402 |
| `office-stage-title.tsx` | タイトルの場面 | 516-562 |
| `office-stage-world.tsx` | フロアの HUD（社長・社員名簿・社長の仕事・フロア案内・操作の帯・目の前の相手）と `WorldTag`・`FloorMap`・`HudButton` | 564-885、1088-1220 |
| `office-stage-talk.tsx` | 会話の場面。`hire`・`update` の mutation、`outcome`、`choices`、`answer`、`say`、答えたあとのフォーカスを自分で持つ（殻の `answered` への依存が消えます） | 141、187-223、246-280、966-1070 |
| `office-stage-room.tsx` | 部屋の見出し・戻るボタン・暗がりと `ROOM_VIEWS[room]` | 911-964 |
| `office-studio.tsx`（今のまま） | スタジオの見出し（887-898）を中に移す | — |
| `office-hud.ts`（今のまま） | `StatusDot` を足す | 1077-1086 |

期待効果：場面を足す・直す PR が殻を触らなくなり、殻のテストが鍵と戻り方だけになります。想定リスク：分割の PR が大きいこと。6節の条件（`git diff --color-moved` で移動だけ）を守れば、1回の revert で戻せます。

# 5. 代案の比較

## 5.1 PR #1105 の大きさ（スナップショットを除いて 66 ファイル・約 11,900 行、削除 0。内訳：components 約 6,000、test 約 3,300、lib 約 1,100、locales 約 1,100）

| 案 | 内容 | 期待効果 | 想定リスク |
|---|---|---|---|
| A（勧めます） | 分け直さない。今の内容で凍結し（これ以上の機能を載せない）、本番に 0039 を適用してマージ。次の部屋からは、部屋ごとに main への小さい PR | 追加だけの変更で、触る既存のファイルは9つ・55 行（レイアウトの metadata、サイドバー、`_app.ts` など）。影響は `/office` にほぼ閉じます。済んだレビューをやり直さずに済みます | PR が大きく、通しで読む人の負担は残ります。凍結を破ると、同じ問題が続きます |
| B | スキーマの境界で2つに分ける：①表・service・router・`types/`（`profile` の列を含む）・通常の表示・DB テスト、②出社の画面・部屋・スタジオ・アプリ化（①の上に積む） | セキュリティのレビューと本番の適用が、lib とスキーマの約 1,500 行に絞れます。①が先に入れば、UI は DB の調整なしで後から入れられます | `09f3fab4` と `111c8695` からスキーマの部分だけを①へ移す作業と、全体の検証・CI が2回分。レビューのやり直し |
| C | Issue ごとに8つに分ける | レビューの単位が最も小さい | 履歴の作り直しが大きく、積んだ PR の管理が増えます。勧めません |

オーナーの承認（本番への適用）が数日かかる見込みなら B、すぐなら A が合います。

## 5.2 0039 の順番（open な PR のうち5本が 0039 を持つ：#1105・#902・#858・#822・#795。【確認】GitHub の API）

| 案 | 内容 | 期待効果 | 想定リスク |
|---|---|---|---|
| ア（勧めます） | #1105 の承認がすぐなら、#1105 を先に適用してマージ。ほかの4本が作り直す | #1105 の 0039 は新しい表だけで、既存の表のロックも既存のコードへの影響もありません。いちばん大きい積み上げ（#1105 → #1136 → 次の部屋）が先に動きます | 残りの4本が1回ずつ作り直し（うち3本は索引だけで軽い） |
| イ | 索引だけの3本（#858・#822・#795。draft でなく clean）を先に入れ、#1105 は最後に1回だけ作り直す | 古い PR から片づきます | #1105 が先に入る PR のたびに作り直すと最大4回。**作り直すのは、本番に適用する直前の1回だけ**にしてください。RLS の2行の足し直しを忘れないこと（L13） |

どちらでも、マージのあとに `ai_employees` へ足す列は 0040 以降の追加にし、0039 はもう作り直さないでください。

## 5.3 2D と 3D のロボットの定義

| 案 | 内容 | 期待効果 | 想定リスク |
|---|---|---|---|
| 形は共通にしない（勧めます） | SVG のプリミティブと立体のメッシュは別物なので、形（頭・目・アンテナ・装備の描き方）は2つのまま。共通にするのは「何を描くか」の層だけ：新しい純粋なファイル `office-robot-look.ts` に、色の表（`ROLE_ACCENTS`・`ROBOT_ACCENT_COLORS`・`ROBOT_SHELL_COLORS`）、`ROLE_GEARS`、`robotAccent`、固定の色（暗い部品・バイザー・目・要確認の目）、`resolveRobotLook(role, status, look)`（装備の解決・休止中の色・灯りの大きさ）を置く。床の色は `office-map-layout.ts` の隣に昼夜の表を1つ | カタログを足したときの漏れが、型（網羅した表）で分かります。3D が 524 行の SVG のファイル（`office-robot.ts`）を読まなくなります | 本実装に進まないなら無駄になります。検証の間はやりません |
| 形まで共通の記述にする | 頭・目などを中間の形の記述にして、2D と 3D の両方がそれを描く | 定義が1つになります | 等角の絵の細かい作り（ハイライト・継ぎ目）と立体は対応が取れず、両方の見た目が落ちます。作る量も最大です |

`office-immersive.tsx` からの動的な読み込みに閉じる今の境界は妥当です（`three` を値で読むのは `office-3d/` の2ファイルだけ、入れ物からは型だけ。【確認】）。916 KB（gzip 240 KB）は切り替えたときだけなので、今は手を入れなくて構いません。本実装では、S2 の控えに加えて、常時 60 コマの描画（`frameloop` の指定なし、影あり）を非力な端末でどうするかを、実機の計測と一緒に決めてください。

## 5.4 依存（#1136）とスキーマ（#1105）の段取り

今の積み方で無理はありません。このリポジトリはマージコミットでマージしている（`Merge pull request #1123`）ので、#1105 が main に入ったあと #1136 の base を main に付け替えれば、差分は 3D のぶんだけになります【推測】。守ること：#1136 を #1105 のブランチへマージしない（依存とスキーマが同じ PR になります）。#1117（Storybook、draft）も `package.json` と `bun.lock` を変えるので、あとに入るほうが `bun install` をやり直します。

# 6. 依存の向きについて（質問への答え）

- `components/features/ai-employees/` が leads・lead-follow-up の型と API を読む向きは、`docs/ARCHITECTURE.md` の決まりに合っています。【確認】lib の側の `lib/features/ai-employees/` はほかの機能を1つも読んでいません（決定 `2026-11-13-ai-employee-agents-work-packs` の「仕組みの側から leads を直接読まない」を守れています）。「両方を並べる画面は components でまとめる」（3節）のとおりの置き方です。
- `office-rooms.ts` が `@/lib/features/leads/list-query` を読むのは妥当です。`list-query.ts` は DB を使わない純粋なファイルで、`components/features/today`・`components/dashboard`・`hooks` など 15 か所以上が同じように読んでいます。`LEAD_BOARD_VIEWS` を `satisfies (LeadListPreset | 'all')[]` で結び、`presetFilters` をそのまま使っているので、一覧のプリセットが変わるとボードも追随します。
- 残る違和感は名前だけです。このディレクトリは今、(1) AI社員の仕組みの画面、(2) アプリの土台の殻、(3) 業務の部屋、の3つを持っています。今は動かさず、新しい部屋を `rooms/` に置くだけにして、`components/features/office/` への移動は、6節の条件が揃い、入口をオフィスにする段（段6）で決めるのがよいです。

# 7. 今のままでよい点

- `ai_employees.profile` を jsonb 1つにした判断。読むのは1行ずつで、組織をまたぐ検索・集計の用途は今ありません。`profile || 差分` はトップレベルの部分の置き換えで、厳格なスキーマを通るので、知らないキーは入りません。スタジオが変えた部分だけを送るのもよいです。直すのは読み取りの粒度（M1）だけです。
- `updateEmployee` は id と `organizationId` の両方で絞り、router は `input.profile` を名前で取り出しています（`api-routers.md` のとおり）。組織の分離の DB テストに、profile の場合も入っています。
- 未適用の 0039 を作り直した判断（`db-schema.md` の手順どおり）。`profile` は NOT NULL で DEFAULT 付きです。
- 「部屋のために API を足さない」「選択肢は1回で実行し、取り消しを付け、実行のあとの最初の選択肢を戻るにする」の型。純粋な関数にして、テストで固定されています。
- 床の配置と席を `office-map-layout.ts` の1か所から 2D と 3D の両方が読むこと。歩く道筋と感情を純粋な関数にしたこと。
- マニフェストを管理画面と認証のレイアウトだけに付け、Service Worker を入れない判断。`three` と `@react-three/fiber` を版を固定して入れたこと。

# 8. 判断が必要な点

1. PR #1105 を分け直すか（5.1 の A か B）。本番への 0039 の適用の承認がいつになるかで決まります。
2. 0039 を誰が先に取るか（5.2）。
3. `autonomy` を #1114 で効かせるとき、それ以前に保存された値をどう扱うか（M8）。今のうちに #1114 に書いておくと、設計で漏れません。
4. 3D を本実装に進めるか。進めるなら、S1〜S3 と 5.3 を本実装の Issue の受け入れ基準に入れます。進めないなら、依存を main に入れずに PR #1136 を閉じます。
5. 入れ物の分割（4.2）をいつ行うか。営業フロアに着手する前を勧めます。ほかのセッションが `office-immersive.tsx` を触っていない時間が要ります。
6. 部屋の札に数字を出す段で、フロア用の件数の問い合わせを1本足すか（L9）。「部屋のために API を足さない」の決定の例外になるので、そのときに決定を更新してください。

# 関係するファイル（絶対パス）

- `components/features/ai-employees/office-immersive.tsx`
- `components/features/ai-employees/office-rooms.ts`
- `components/features/ai-employees/office-room-leads.tsx`
- `components/features/ai-employees/office-lead-file.tsx`
- `components/features/ai-employees/office-room-due.tsx`
- `components/features/ai-employees/office-room-parts.tsx`
- `components/features/ai-employees/office-studio.tsx`
- `components/features/ai-employees/office-robot.ts`
- `components/features/ai-employees/office-scene.ts`
- `components/features/ai-employees/office-map-layout.ts`
- `components/features/ai-employees/office-screen.tsx`
- `components/features/ai-employees/office-3d/office-canvas-3d.tsx`
- `components/features/ai-employees/office-3d/robot-3d.tsx`
- `components/features/lead-follow-up/use-record-contact.tsx`
- `components/features/lead-follow-up/task-parts.tsx`
- `lib/features/ai-employees/types/profile.ts`
- `lib/features/ai-employees/service.ts`
- `lib/features/ai-employees/api/router.ts`
- `lib/features/leads/api/router.ts`
- `drizzle/0039_ai_employees.sql`
- `test/unit/features/ai-employees/profile.test.ts`
- `test/unit/components/ai-employees/office-rooms.test.ts`

このレビューは AI が読み取りだけで行ったものです。【推測】の項目（特に M2 の Esc の二重の配分、S2 の失敗時の振る舞い、5.4 の base の付け替え）は、直す前に実際の動きで確かめてください。ファイルの編集・コミット・GitHub への書き込みは行っていません。
