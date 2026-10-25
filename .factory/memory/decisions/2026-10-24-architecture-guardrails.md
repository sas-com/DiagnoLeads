---
id: 2026-10-24-architecture-guardrails
date: 2026-10-24
category: Architecture
title: "配置は今のまま、import の向きを arch:check で守り、ハブを1つずつ解消する（#450, #451）"
status: active
superseded_by: []
issues: [450, 451, 452, 478, 479, 623]
paths: ["scripts/check-architecture.ts", "scripts/architecture/**", "docs/ARCHITECTURE.md"]
---

### [Architecture] 配置は今のまま、import の向きを arch:check で守り、ハブを1つずつ解消する（#450, #451）
- **日付**: 2026-10-24
- **決定**: ディレクトリ構成（`lib/features/{feature}`・`components/features/{feature}`・`app/[locale]/(group)`・`test/` に別置き）は変えない。層と依存の向きと機能の型を `docs/ARCHITECTURE.md` に書き、`bun run arch:check`（CI の Lint & Type Check）で守る。ルールより前からある違反は1件ずつ許可リスト（`scripts/architecture/allowlist.txt`）に載せ、減らす方向にだけ動かす。他の機能から読んでよいのは `types/`・`types.ts`・`service.ts` だけ（オーナーの依頼「拡張性の高い構成に見直す」に対し、3案を比べた結論）
- **理由**:
  - 10/09〜10/24 の PR 204 件で、記録が残る衝突9件はすべてハブ（locales・decisions.md・bun.lock・lead-detail-view.tsx・_app.ts・_journal.json）で起きていて、機能のディレクトリでは0件。新しい機能の PR は機能の外の共有ファイルを中央値 12.5 編集していた。直すべきなのは配置ではなくハブ
  - 層の向きは守れていた（lib → 画面 0、クライアントから届くサーバー専用のコード 0、ファイルの循環 0）が、守る仕組みがなかった。機能どうしの import 163 本のうち 152 本が相手の内部を直接読み、18 機能が1つの循環にまとまっていた
  - 縦割り（機能のディレクトリに画面・文言・表を集める）とドメインのまとめは、ハブの数を減らす効果は同じで、約510ファイルの移動か所属の判断が毎回要る。移行の途中で置き場所が2通りになる
- **ルール**:
  - 許可リストに行を足すときは PR に理由を書く。違反を減らしたら `--update` で行を消す
  - `cross-feature-internal` の許可リストの項目は「読む機能 -> 読まれるファイル」にする（#623、2026-10-25）。読まれるファイルだけで持つと、許可リストにある内部のファイルは、どの機能からでも新しく読めて検出されない。10月の main の278コミットを、今のルールで1コミットずつ数え直すと、許可リストにあるファイルを別の機能が新しく読んだ組が34件あった（ファイルが初めて読まれた組は52件。arch:check を入れた後のマージ #563 でも3件）。そのため、2週間の観測を待たずに形を変えた。許可リストの合計は、10/25 の main（#666 のマージ後）で118件から153件になる（`cross-feature-internal` の43ファイルが78組になる）。読む機能の順に並ぶので、並行の PR が足す行は、それぞれの機能の所にまとまる
  - マージの前に main を取り込んで `arch:check` を流す。開いている他のブランチにも流し、新しい違反が出るセッションに知らせる
  - ファイルの移動・ハブの分割は、移動だけの1本の PR で行う（条件は `docs/ARCHITECTURE.md` の6節）。10/29 の公開の前後と、RLS の作業中（11/4〜11/14）は行わない
  - `arch:check` は最初から落ちたら止める。警告だけの期間は置かない（Lint & Type Check はブランチ保護の必須の検査なので、このステップも必須になる。オーナー判断 2026-10-24）
  - 大きな分割は条件を満たしたときだけ行う（オーナー判断 2026-10-24）
    - `lib/db/schema.ts` をドメインごとに分ける（#478）：schema.ts の衝突か近い行の同時編集が2週間で2件以上あったとき、または表の DROP で持ち主を探す作業が出たとき
    - `locales/{ja,en}/common.json` の既存の名前空間を分ける（#479）：新しい名前空間の置き場（#472）のマージから2週間で、common.json の衝突か近い行の同時編集が2件以上あったとき
  - レジストリ・自動登録・イベントバス・プラグインは作らない。dependency-cruiser などの依存も足さない
- **却下案**: 機能ごとの縦割り（`lib/features/{x}/{ui,messages,schema}`。テストの置き場所・UI の置き場所・文言の置き場所の3つの決まりを同時に変える必要があり、衝突のデータの裏づけがない）、ドメインごとのまとめ（`lib/features/{domain}/{feature}` や domains.ts。決定 base-feature-modules に反し、所属の判断が毎回要る）、件数だけで比べる ratchet（1件消して1件増えたのを見逃す）、Biome の noRestrictedImports（完全一致だけで、import type も区別できない）
