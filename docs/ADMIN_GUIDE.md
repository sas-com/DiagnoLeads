# DiagnoLeads 管理者ガイド

この文書は、**利用者向けの説明を持ちません**。組織の設定・メンバーの招待・役割による違いなど、オーナーと管理者が画面で行う操作の説明は、管理画面のヘルプが正本です（ヘルプセンター `/ja/help` の「設定の使い方」。開き方は [USER_GUIDE.md](./USER_GUIDE.md)）。

開発・運用者向けの情報は、次の今の文書を見てください。以前この文書にあった記述（Next.js 15、PM2 での運用、権限の表、REST API v2、Webhook の署名の確かめ方など）は今の実装と合っていないため消しました（#876）。

| 知りたいこと | 正本 |
|------|------|
| 開発の始め方・作業の流れ | [CONTRIBUTING.md](../CONTRIBUTING.md)、[docs/SPRINTPATH.md](./SPRINTPATH.md) |
| 層と依存の向き・機能を足すときに触る場所 | [docs/ARCHITECTURE.md](./ARCHITECTURE.md) |
| テストの種類と流し方 | [docs/TESTING.md](./TESTING.md) |
| 本番へのデプロイ・環境変数 | [docs/deployment-guide.md](./deployment-guide.md) |
| データベースのバックアップと復元 | [docs/backup-strategy.md](./backup-strategy.md)、[docs/runbooks/database-restore.md](./runbooks/database-restore.md) |
| リード・商談・顧客探しの段階と、MQL・SQL | [docs/PIPELINE_LIFECYCLE.md](./PIPELINE_LIFECYCLE.md) |
| 役割ごとの権限 | `lib/auth/permissions.ts`（CASL の定義が正本） |
| Webhook の送信と署名 | `lib/features/webhooks/services/webhook-service.ts` |

以前の内容が要るときは、git の履歴にある [消す前の版](https://github.com/yusuke-kurosawa/DiagnoLeads/blob/d1b3788e0dd737cea54c13f2667db97b443ee56a/docs/ADMIN_GUIDE.md) を見てください。
