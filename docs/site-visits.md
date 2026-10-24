# 公開ページの訪問の計測（#412）

自前で、公開ページの表示を数えます。クッキーは使わず、IP アドレスとブラウザの情報（UA）は保存しません。決まりは `.factory/memory/decisions/2026-10-23-site-visit-measurement.md` を見てください。

## 有効にする順番（本番）

1. プライバシーポリシー（https://sas-com.com/privacy/）に、計測のことが載ったのを確かめる。**載るまでは有効にしない**（#51 の公開の条件）
2. 本番のマイグレーション（`drizzle/0031_site_visits.sql`）を、マージより先に当てる
3. 読み取り専用のユーザー（`dl_readonly`）から `site_visit_salts` を読めなくし、読めないことを確かめる（下の「`dl_readonly` の権限」）。`dl_readonly` は本番にだけあるので、マイグレーションには入れていない
4. PR をマージする（この時点では計測は off のまま。ページは何も送らない）
5. Vercel の Production に `SITE_VISITS_ENABLED=true` を入れて、再デプロイする
6. 本番で確かめる（下の「確かめ方」）

止めるときは、`SITE_VISITS_ENABLED` を消して（または `true` 以外にして）再デプロイします。止めている間は、ページは何も送らず、`/api/collect` は何も書きません。

## `dl_readonly` の権限（本番。DB の管理者と行う）

`visitor_hash` はサーバーの秘密（`BETTER_AUTH_SECRET`）を鍵にした HMAC なので、DB やバックアップだけでは、ソルトと並べても既知の IP・UA と照合できません。それでも鍵が漏れたときの備えとして、その日のソルトは読み取り専用のユーザーから読めなくしておきます。

1. 先に、`dl_readonly` の権限の付け方を確かめる（情報システム部門の確認が要る）
   ```sql
   -- RLS を越えて読めるか（rolbypassrls）と、属するロール
   select r.rolname, r.rolbypassrls,
          array(select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid
                where m.member = r.oid) as member_of
   from pg_roles r where r.rolname = 'dl_readonly';
   -- 既定の権限（ALTER DEFAULT PRIVILEGES）で、新しい表に自動で SELECT が付くか
   select pg_get_userbyid(defaclrole) as owner, defaclnamespace::regnamespace as schema,
          defaclobjtype, defaclacl
   from pg_default_acl;
   -- 今の3つの表の権限
   select t, has_table_privilege('dl_readonly', t, 'SELECT') as can_select
   from unnest(array['public.site_visits', 'public.site_visit_daily', 'public.site_visit_salts']) as t;
   ```
   - 既定の権限で付いている：新しい表は読めるようになっている。次の REVOKE が要る
   - 一括の `GRANT SELECT ON ALL TABLES IN SCHEMA public` だけで付けている：新しい表はそもそも読めない。下の「確かめ方」の SQL を `prod-ro.sh` で流すなら、表を名指しで付ける（`grant select on public.site_visits, public.site_visit_daily to dl_readonly;`）。`ALL TABLES` を流し直すとソルトまで読めるようになるので、流し直したら次の REVOKE も流し直す
   - `pg_read_all_data` などのロールに属している：表ごとの REVOKE は効かない（下の確認が true のまま）。ロールの付け方を変える
   - `rolbypassrls` が false：3つの表は RLS が有効でポリシーがないので、`dl_readonly` からは 0 件に見える（エラーにはならない）。「確かめ方」の件数は、管理者の接続で見る
2. ソルトを読めなくする
   ```sql
   revoke all on table public.site_visit_salts from dl_readonly;
   ```
3. 確かめる。**false** になること
   ```sql
   select has_table_privilege('dl_readonly', 'public.site_visit_salts', 'SELECT');
   ```

## 確かめ方

- AX のページ（例：`/ja/ax-migration`）を開き、ブラウザの開発ツールの「ネットワーク」で、`/api/collect` への送信が 204 で返ることを見る
- 読み取り専用の接続（`prod-ro.sh`）で、件数だけを見る（`dl_readonly` が RLS を越えられないときは、上の「`dl_readonly` の権限」を見る）：
  ```sql
  select day, page_type, count(*) as views, count(distinct visitor_hash) as visitors
  from site_visits group by 1, 2 order by 1 desc, 2;
  ```
- 管理画面（`/ja/dashboard` など）を開いても、`/api/collect` への送信が出ないことを見る
- 記録が**運営の組織**（`AX_DIAGNOSIS_ORGANIZATION_ID`、なければ `DEFAULT_ORGANIZATION_ID`）に入っていることを見る。どちらの変数も空だと、自社のページ（AX サイト・トップ・landing）は1件も記録されない：
  ```sql
  select organization_id, count(*) from site_visits group by 1;
  ```

## 記録するもの

| 列 | 中身 |
|---|---|
| `organization_id` | ページの組織（サーバーで決める） |
| `path`・`page_type` | ページのパス（クエリなし）と種類 |
| `referrer_host` | 参照元のホストだけ。外の参照元が付くのは、読み込んだときのページだけ（サイト内の移動では、全体を読み直したときと同じく自社のホスト） |
| `utm_*`・`from_ref` | URL の utm_* と、AX の `from`（許可した値だけ） |
| `device` | desktop／mobile／tablet |
| `visitor_hash` | その日だけのソルト・組織・IP・UA を、`BETTER_AUTH_SECRET` を鍵にした HMAC |
| `day` | 日本時間の日付（時刻は持たない） |

`BETTER_AUTH_SECRET` を変えると、その日の訪問者のハッシュが変わるので、その日だけ同じ人が2人に数えられます。

毎日の処理（`/api/cron/cleanup-webhook-deliveries`、03:00 UTC）が、直近2日と消す直前の日の合計を `site_visit_daily` に書き、90日より前の記録と前の日のソルトを消します。

## 上限（`lib/features/site-visits/record.ts`）

ブラウザ以外からは Origin を自由に付けられるので、記録の水増しを上限で抑えます。上限を超えた表示は書かず、`/api/collect` はいつもどおり 204 を返します。

| 上限 | 数え方 | 値 |
|---|---|---|
| `SITE_VISIT_RATE_LIMIT` | IPv4 は1アドレス、IPv6 は /64 | 10分に120件 |
| `SITE_VISIT_RATE_LIMIT_48` | IPv6 の /48（/64 を回して上の上限を抜けられないように）。/64 より先に数える | 10分に600件 |
| `SITE_VISIT_DAILY_CAP` | 組織ごと・日本時間の1日 | 10,000件 |

- 組織の1日の上限を超えると、その日の残りは記録されません（ページと診断フォームは止まらない）。超えた最初の1件で、運用の通知（発生場所 `site-visits/daily-cap`、`SiteVisitDailyCapReached`）が出ます。同じ発生場所の通知は10分に1通までなので、ほかの組織が続けて超えたときは、Vercel のログ（`Site visits reached the daily cap`。組織 ID と日付が出る）で確かめます
- 正当な訪問で超えるようになったら、`SITE_VISIT_DAILY_CAP` を上げます
- IPv6 は /48 を先に数えます。/48 で断った表示は、/64 を変えても回数制限の表に行を足さないので、表の行は /48 ごとに許した件数までに収まります。その代わり、1つの /64 が自分の上限を超えて送り続けると、同じ /48 の計測もその10分は止まります（止まるのは計測だけ）
- 記録に失敗すると、Vercel のログに `Site visit collect error:` が出ます（エラーの種類・コード・表・コードの場所だけ。DB のエラーの本文には `visitor_hash` や utm_* の値が入るので出さない）。運用の通知（発生場所 `site-visits/collect`）は応答を返したあとに送り、10分に1通までです
- その日のソルトは、サーバーのメモリにも当日分だけ覚えます。上限で断る表示は、回数制限の表を1〜2回書くだけで、ソルトや診断を DB に読みに行きません
