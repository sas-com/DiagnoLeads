---
id: 2026-11-17-trpc-request-timeout
date: 2026-11-17
category: Architecture
title: "ブラウザーの tRPC の要求に時間の上限を付ける（サーバーの上限 30秒 ＋ 5秒）。上限で切れた要求は送り直さない（#1254）"
status: active
superseded_by: []
issues: [1254, 1251, 1199]
paths: ["lib/trpc/request-timeout.ts", "lib/trpc/retry.ts", "app/providers.tsx", "vercel.json", "components/features/ai-employees/office-lead-file.tsx"]
---

### [Architecture] ブラウザーの tRPC の要求に時間の上限を付ける（サーバーの上限 30秒 ＋ 5秒）。上限で切れた要求は送り直さない（#1254）
- **日付**: 2026-11-17
- **きっかけ**: 出社の画面の部屋は、保存している間、出口（Esc・「ボードに戻る」・「フロアへ戻る」）を閉じる（決定 `2026-11-13-office-is-the-base`）。保存の要求が返ってこないと、出口が閉じたままになる（PR #1229 の `ui-ux-specialist` のレビュー）。サーバーは 30秒で必ず終わる（`vercel.json` の `maxDuration`）が、ブラウザーの側には上限が無かった
- **決定**（オーナーの判断 2026-11-17「進めてください」。#1254 の案 A）:
  - ブラウザーの tRPC の要求（`app/providers.tsx` の `httpBatchLink`）に、時間の上限を付ける。値は、サーバーの上限 ＋ 5秒（`REQUEST_TIMEOUT_MS`）。応答の本文を読み終えるまでを含む
  - 上限で切れた要求は、**送り直さない**（`retryUnlessDenied`）。サーバーでは終わっていることがあり、保存を送り直すと二重に記録される。問い合わせ（読み取り）も同じ扱いにした（上限まで待ったあとに、さらに2回待たせないため）
  - 「保存している間は出口を閉じる」決まりは変えない。保存が上限で失敗として終わるので、出口が開く
- **この上限で終わらないもの**: 通信が切れているときの保存。問い合わせのライブラリは、通信が切れている間、保存を送らずに待つ（`networkMode` の既定）。送っていない要求には上限が効かない。これは #1251（案 (a)/(b) をオーナーが選ぶ。開発室は PR #1291 で (a)）の話で、ここでは `networkMode` も `onBusyChange` の契約も変えていない
- **形**:
  - `lib/trpc/request-timeout.ts`：`fetchWithTimeout`（tRPC のリンクの `fetch` に渡す）。tRPC が渡す取り消しの合図は残し、呼び出し側の取り消しは今までどおり効く（理由もそのまま）。上限で切ったときの理由は `RequestTimeoutError`。tRPC のエラーの `cause` をたどって見分ける（`isRequestTimeout`）
  - `SERVER_MAX_DURATION_MS` は `vercel.json` の `functions["app/api/**/*"].maxDuration` と同じ値。テストが `vercel.json` を読んで突き合わせる（`scripts/verify-changed.ts` の `DISK_READERS` に登録）
  - サーバー側のクライアント（`lib/trpc/server.ts`）には付けていない
- **マーケティング室の顧客ファイル**（`office-lead-file.tsx`）: 保存が失敗したら、連絡の記録を読み直す。上限で切れたときは「うまくいきませんでした。もう一度」とは言わず、「応答がありませんでした。保存されたかどうかは、連絡の記録で確かめてください」と言う（保存されていることがあるので、そのままもう一度押すと二重に記録される）
- **確かめ方**: 本物の tRPC のクライアント・本物の `fetch`・手元のサーバー（応答しない／途中で止まる／応答する）で、上限で失敗すること・送り直さないこと・呼び出し側の取り消しが効くこと・ほかの失敗は今までどおり送り直すことを確かめた（`test/unit/lib/trpc/request-timeout.test.ts`）。実際のブラウザーでは確かめていない
- **残したもの**:
  - 失敗した保存を1回送り直す設定（`mutations.retry: retryUnlessDenied(1)`）は、上限のほかは変えていない。通信エラーで応答だけが届かなかった保存は、今までどおり送り直され、二重に記録されることがある（別の Issue にするなら、保存の送り直しをやめるか、保存に重複を防ぐ鍵を付ける）
  - ほかの部屋（営業フロア・開発室・総務・受付）の「応答なし」の言い方は、各部屋のファイルのまま（上限で切れると、今の「うまくいきませんでした」が出る）
- **ルール**:
  - `vercel.json` の `maxDuration` を変えたら、`SERVER_MAX_DURATION_MS` も変える（テストが落ちて気づける）
  - 30秒を超える処理を tRPC に足さない（足すなら、サーバーの上限とこの上限の両方を見直す）
