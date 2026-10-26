---
id: 2026-10-26-ax-device-font-on-mobile
date: 2026-10-26
category: UI
title: "AX サイトの日本語は、スマホとタッチのタブレット（1024px 未満）で端末のフォント、パソコンで Noto Sans JP にする（#510、2026-10-11-ax-diagnosis-v2 の一部を変更）"
status: active
superseded_by: []
issues: [510, 612]
paths: ["components/features/ax-site/fonts.ts", "test/unit/components/ax-site/ax-fonts-css.test.ts"]
---

### [UI] AX サイトの日本語は、スマホとタッチのタブレット（1024px 未満）で端末のフォント、パソコンで Noto Sans JP にする（#510、2026-10-11-ax-diagnosis-v2 の一部を変更）
- **日付**: 2026-10-26（オーナー判断：LP 品質の見直しのセッションで、推奨の案を選んだ。#510 の 10/26 のコメント。切り替えの条件は、UI/UX のレビューを受けて「幅だけ」から「幅かマウス」に直した。パソコンの見た目を変えないという、選んだ案のねらいどおりにするため）
- **決定**:
  - 幅が 1024px（Tailwind の lg。`--breakpoint-lg`）以上か、マウスの端末（`(hover: hover) and (pointer: fine)`）なら、今の Noto Sans JP（maru2-dx.com と同じ）
    - パソコンは、ウィンドウを狭くしても、拡大しても、印刷しても Noto Sans JP のまま
  - それ以外（スマホと、1024px 未満のタッチのタブレット）は、端末の日本語のフォント。Noto Sans JP の Web フォントは1つも読まない
    - 並び（`app/globals.css` の `--ax-font-device`）：Hiragino Kaku Gothic ProN、Hiragino Sans（iOS・macOS）、Noto Sans CJK JP、Yu Gothic UI、Yu Gothic、Meiryo、最後に sans-serif
    - ProN を先にするのは、W3 と W6 しかないので、太字（700）が Noto Sans JP の Bold に近い W6 になるため。Hiragino Sans は、より太い字を選ぶことがある
    - Android は、名前ではなく sans-serif と `lang="ja"` で決まることが多い（多くの機種で Noto Sans CJK JP。機種や利用者の設定で違う字にもなる）
  - 数字・英字の Lato（`font-ax-latin`。2ファイル・28 KiB を先読み）は、どの端末でもそのまま
  - 切り替えは `.ax-site` の `--ax-font-ja` で行う。`font-ax`・`font-ax-latin` は `var(--ax-font-ja, var(--ax-font-device))` を使う
- **変えたところ**: `2026-10-11-ax-diagnosis-v2` の「デザインは同社の maru2-dx.com に合わせる」のうち、スマホとタッチのタブレットの日本語の字体だけ。色・配置・パソコンの字体は変えない
- **理由**:
  - Noto Sans JP は、ページごとに 27〜40 個（571〜849 KiB）の分割ファイルを読む。Lighthouse のモバイルの見積もりは、最初の描画より前に読み終えたそれらを、描画を止めるものとして数える。ランナーの30回のうち26回で、Performance 35〜66・FCP 4.4〜6.4 s になった（#510 の 10/26 のコメント）
  - フォントの入れ替わりで、メイン LP のモバイルの CLS が 0.219 になっていた
  - スマホの利用者の通信から、ページごとに 0.6〜0.85 MB が消える
  - 見た目の差が小さい
    - 多くの Android は、端末の字が Noto Sans CJK（Noto Sans JP と同じ字形）
    - iPhone はヒラギノ角ゴ（同じゴシック体。英数字の幅と行の高さが少し変わる）
    - パソコンは変わらない。デスクトップの Lighthouse は今も 95〜100 なので、パソコンで変える得は小さい
  - 手元で確かめた（2026-10-26）
    - Lighthouse 13.5.0 のモバイル（ランナーと同じオプション）でも、読んだフォントは Lato の2つだけで、CLS は 0。Lighthouse のモバイルは、タッチの端末として判定される
    - Playwright で、スマホと iPad の縦は Noto を0個、iPad の横・パソコン・パソコンの狭いウィンドウ（800px）は 40 個（メイン LP）。パソコンの印刷も Noto Sans JP
- **却下案**:
  - 幅だけで切り替える（最初の案）：パソコンでも、ウィンドウを 1024px 未満にしたとき・拡大したとき・印刷したときに、Windows では游ゴシック UI になる。「パソコンは変わらない」と合わない
  - マウスの端末だけ Noto Sans JP（幅を見ない）：iPad の横でも端末のフォントになる。差は小さいが、今の配置の切り替え（lg）とそろえた
  - 全部の端末で端末のフォント（#510 の方法 A）：パソコンの見た目（Windows では游ゴシック・メイリオ）が変わるのに、得が小さい
  - 見出し（h1〜h3）だけ Web フォント：日本語の字は多くの分割ファイルに散らばっているので、見出しだけでもメイン LP で 29個・615 KiB、Access LP で 19個・408 KiB、診断で 11個・257 KiB を読む。見積もりの崩れと CLS が残る
  - 今のまま、Lighthouse の測り方を変える：利用者の通信量と CLS が残る。決定 `2026-10-24-performance-targets` の D3 を変えると、これまでの値と比べられない
  - `font-display: optional`：CLS は消えるが、フォントの要求は出るので、見積もりの崩れが残る
  - 使う字だけのフォントを自前で作る：コラムや CMS で字が増えるたびに作り直しが要る
- **ルール**:
  - `--ax-font-device` に `Noto Sans JP`・`Lato` を書かない。next/font は @font-face をその名前で作る（本番の CSS で確かめた）ので、書くとスマホでも Web フォントを読む。`test/unit/components/ax-site/ax-fonts-css.test.ts` が、`fonts.ts` の import から名前を出して確かめる
  - Noto Sans JP の `preload: false` を外さない。先読みすると、スマホでもファイルを読む
  - スマホで Noto Sans JP を読まないことは、`test/e2e/ax-landing.spec.ts` の @smoke の E2E（スマホとパソコン）が、PR ごとに確かめる
  - 切り替えの 1024px は px で書く（`--breakpoint-lg` と同じ）。rem で書くと、ブラウザの既定の文字サイズで動く
  - 効果は、毎日の Lighthouse（#569）でも確かめる：モバイルで Noto Sans JP のファイルを読まず、「遅い回」が出ないこと
  - 見た目は実機で確かめる（iPhone のヒラギノでの折り返し、最初の画面に診断ボタンが入るか #536）。Linux の CI と手元には、ヒラギノも Noto Sans CJK も無い
    - #536 の E2E（390px、タッチなし）は、マウスの端末として Noto Sans JP で描くので、今までどおりの字で測る
    - Windows の DevTools のスマホ表示（タッチ）は游ゴシック UI で描くので、どのスマホとも違う。字体の良し悪しは、それで判断しない
  - 知っておくこと
    - iPad を初めて横にすると、そこで Noto Sans JP を読み、入れ替わりで字がもう一度動く（配置も同じ幅で変わる）
    - コラムの見出しの画像の中の題名は、Noto Sans JP で描いたまま。スマホでは、その下の h1 と字体が違う（画像は飾り）
    - `font-medium`（500）の2か所は、500 を持たない端末のフォントでは普通の太さになる
