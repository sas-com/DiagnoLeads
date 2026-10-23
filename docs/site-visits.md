# 公開ページの訪問の計測（#412）

自前で、公開ページの表示を数えます。クッキーは使わず、IP アドレスとブラウザの情報（UA）は保存しません。決まりは `.factory/memory/decisions.md` の「[Analytics] [Security] 公開ページの訪問を自前で計測する」を見てください。

## 有効にする順番（本番）

1. プライバシーポリシー（https://sas-com.com/privacy/）に、計測のことが載ったのを確かめる。**載るまでは有効にしない**（#51 の公開の条件）
2. 本番のマイグレーション（`drizzle/0031_site_visits.sql`）を、マージより先に当てる
3. PR をマージする（この時点では計測は off のまま。ページは何も送らない）
4. Vercel の Production に `SITE_VISITS_ENABLED=true` を入れて、再デプロイする
5. 本番で確かめる（下の「確かめ方」）

止めるときは、`SITE_VISITS_ENABLED` を消して（または `true` 以外にして）再デプロイします。止めている間は、ページは何も送らず、`/api/collect` は何も書きません。

## 確かめ方

- AX のページ（例：`/ja/ax-migration`）を開き、ブラウザの開発ツールの「ネットワーク」で、`/api/collect` への送信が 204 で返ることを見る
- 読み取り専用の接続（`prod-ro.sh`）で、件数だけを見る：
  ```sql
  select day, page_type, count(*) as views, count(distinct visitor_hash) as visitors
  from site_visits group by 1, 2 order by 1 desc, 2;
  ```
- 管理画面（`/ja/dashboard` など）を開いても、`/api/collect` への送信が出ないことを見る

## 記録するもの

| 列 | 中身 |
|---|---|
| `organization_id` | ページの組織（サーバーで決める） |
| `path`・`page_type` | ページのパス（クエリなし）と種類 |
| `referrer_host` | 参照元のホストだけ |
| `utm_*`・`from_ref` | URL の utm_* と、AX の `from`（許可した値だけ） |
| `device` | desktop／mobile／tablet |
| `visitor_hash` | その日だけのソルト・組織・IP・UA のハッシュ |
| `day` | 日本時間の日付 |

毎日の処理（`/api/cron/cleanup-webhook-deliveries`、03:00 UTC）が、直近2日と消す直前の日の合計を `site_visit_daily` に書き、90日より前の記録と前の日のソルトを消します。
