# テスト戦略ガイド

> DiagnoLeads v2 のテスト原則・ルールを定義

---

## テストピラミッド

```
        ┌───────────┐
        │   E2E     │  少量・高コスト・遅い
        │  Tests    │  クリティカルパスのみ
        ├───────────┤
        │Integration│  中量・中コスト・中速
        │  Tests    │  モジュール連携
        ├───────────┤
        │   Unit    │  大量・低コスト・高速
        │  Tests    │  ビジネスロジック
        └───────────┘
```

| 種別 | 割合目安 | 実行時間 | 外部依存 |
|------|---------|---------|---------|
| Unit | 70% | 数秒 | なし |
| Integration | 20% | 数十秒 | モック |
| E2E | 10% | 数分 | 実環境 |

---

## 1. Unit Tests

### 定義
**外部依存なし**で実行可能な、単一関数・モジュールのテスト

### 命名規則
```
*.test.ts
```

### 置き場所
- ユニットテストは `test/unit/**` に置く（ソースと同じ場所には置かない。決定 `base-test-directory`）
- 機能（`lib/features/{feature}`）のテストが複数あるときは、`test/unit/features/{feature}/` のサブディレクトリに置いてよい（`{feature}` は `lib/features/` のディレクトリ名と同じ）。1つだけなら従来どおりフラットに置く（`test/unit/features/{feature}.test.ts` か `{feature}-<対象>.test.ts`）。決定 `2026-10-24-test-feature-subdirectories`（`base-test-directory` の補足）
- 実 DB のテストは `test/unit/integration/*.db.test.ts`（下の「実 DB テスト」。決定 `2026-10-24-test-file-naming`）
- 既存のテストを移すためだけの PR は作らない（決定のルール）

### 対象
- 純粋関数（入力→出力が決定的）
- バリデーション・スキーマ
- 型定義・ユーティリティ
- ビジネスロジック（計算・変換）
- Reactコンポーネント（レンダリング・イベント）

### 原則

#### 1.1 AAA パターン
```typescript
it('should calculate lead score correctly', () => {
  // Arrange（準備）
  const lead = { responses: [{ score: 80 }, { score: 60 }] };
  
  // Act（実行）
  const result = calculateLeadScore(lead);
  
  // Assert（検証）
  expect(result).toBe(70);
});
```

#### 1.2 単一責任
- 1テスト = 1検証項目
- テスト名で何を検証しているか明確に

```typescript
// ❌ Bad: 複数の検証
it('should validate email', () => {
  expect(isValidEmail('test@example.com')).toBe(true);
  expect(isValidEmail('invalid')).toBe(false);
  expect(isValidEmail('')).toBe(false);
});

// ✅ Good: 単一の検証
it('should return true for valid email', () => {
  expect(isValidEmail('test@example.com')).toBe(true);
});

it('should return false for invalid format', () => {
  expect(isValidEmail('invalid')).toBe(false);
});

it('should return false for empty string', () => {
  expect(isValidEmail('')).toBe(false);
});
```

#### 1.3 外部依存の排除
```typescript
// ❌ Bad: 外部依存あり
import { db } from '@/lib/db/client';

it('should get user', async () => {
  const user = await db.query.users.findFirst(); // DB接続必要
});

// ✅ Good: 純粋関数テスト
it('should format user name', () => {
  const result = formatUserName({ firstName: '太郎', lastName: '田中' });
  expect(result).toBe('田中 太郎');
});
```

モックは本物と同じく参照を保つ（Next の `useRouter` のように本物が描画のたびに同じオブジェクトを返すものは、`const router = { push: mocks.push }; useRouter: () => router` と1つだけ作って返す。描画ごとに新しいオブジェクトを返すと、それに依存する effect が毎回やり直され、依存の漏れた effect を見逃す。#636）。

#### 1.4 テストデータの独立性
```typescript
// ❌ Bad: 共有状態
let counter = 0;
it('test 1', () => { counter++; expect(counter).toBe(1); });
it('test 2', () => { counter++; expect(counter).toBe(2); }); // 順序依存

// ✅ Good: 独立したテスト
it('test 1', () => {
  const counter = createCounter();
  counter.increment();
  expect(counter.value).toBe(1);
});
```

#### 1.5 画面のテストは、CPU の混み具合で結果が変わらないように書く

手元では並行するセッションと CPU を取り合い、画面のテストが単独のときの5〜7倍遅くなることがある（#573）。遅くなっても落ちないように、次のように書く。

- 時間で動く処理（入力の後の待ち・自動保存）を、本物の時計で待たない
  - 待ちそのものを確かめるテストは、偽のタイマー（`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`）で時計を進める。入力は `fireEvent` で送る（user-event と `findBy`・`waitFor` は中で `setTimeout` を待つので、vitest の偽のタイマーの下では止まる）
  - 待ちがテストの対象でないときは、その処理を止める（例：`lead-hearing-editor-inputs.test.tsx` は自動保存を止め、自動保存は `lead-hearing-editor.test.tsx` で偽のタイマーを使って確かめる）
- 要素の多い画面では、`getByLabelText` と、数の多い役割（ボタンなど）の `getByRole` を画面全体にかけず、`within()` で行・セクション・ダイアログ（ポップオーバー）に絞る。`getByRole` は指定した役割の要素すべての名前を計算し、`getByLabelText` は画面のすべての要素のラベルを探すので、ボタンが100を超える画面では1回に0.1〜1秒かかる
  - タブのように数の少ない役割なら、画面全体にかけても軽い（例：`lead-hearing-editor-inputs.test.tsx` は、どの行にも入らない商談日の入力欄を `getByRole('textbox', …)` で探す）
- 長い値は `type` で1文字ずつ打たず、`clear` と `paste` で入れる（1文字ごとに画面全体が描き直される）。1文字ごとの動きを確かめるときだけ `type` を使う
- `testTimeout`（20秒、`vitest.config.ts`）を上げて済ませない。遅さが隠れるうえ、時間切れになったテストは止まらずに動き続け、同じファイルの次のテストの入力欄に文字を打ち込んで落とす
- 負荷の下で確かめるときは、CPU を回すだけのプロセスと vitest を `taskset -c 0` で1つのコアにまとめる。手元のマシンはほかのセッションと共用しているので、全部のコアに負荷をかける形（プロセスを何本も起こし、複数の vitest を同時に流す）は使わない。ほかのセッションのテストを時間切れにして、同じ問題をよそに起こす
  - 例：`taskset -c 0 timeout 600 sh -c 'while :; do :; done' &` を3本起こして PID を控え、`taskset -c 0 bunx vitest run <ファイル> --reporter=verbose` で各テストの時間を見る。各テストが3〜6倍遅くなり、確かめるには足りる。終わったら、起こしたプロセスを PID で止める
- 手元で全体（`bun run test:run`）を流すときは、型チェック・ビルド・E2E と並べない。ほかのセッションも重い処理をしているときは、`bun run test:run --maxWorkers=2` のように並列数を抑える（既定はコアの数 − 1。4コアなら3）

### カバレッジ目標
- **ビジネスロジック**: 80%+
- **バリデーション**: 100%
- **ユーティリティ**: 100%

---

## 2. Integration Tests

### 定義
**モックを使用**して、複数モジュールの連携をテスト

### 命名規則
```
*.test.ts（test/unit/ の下）
```

vitest が実行するのは `test/**/*.{test,spec}.{ts,tsx}` だけ（`test/e2e/` は除く。Playwright が流す）。`*.integration.ts` は実行されないので使わない（2026-10-24 の決定 `2026-10-24-test-file-naming`）。実際の PostgreSQL を使うものは、下の「実 DB テスト」の `*.db.test.ts`。

### 対象
- DB操作（Drizzle ORM モック）
- Cache操作（Redis モック）
- Email送信（Resend モック）
- 外部API連携（Anthropic/OpenAI モック）
- tRPC routers（コンテキストモック）
- 認証フロー（better-auth モック）

### 原則

#### 2.1 モック境界の明確化
```typescript
// モックする外部依存を明示
vi.mock('@/lib/db/client', () => ({
  db: {
    query: { users: { findFirst: vi.fn() } },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  },
}));

vi.mock('@/lib/features/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'email-123' }),
}));
```

#### 2.2 実際の関数をテスト
```typescript
// ✅ Good: 実際の関数をインポートしてテスト
import { createUser } from '@/lib/features/users/service';

it('should create user and send welcome email', async () => {
  const mockDb = vi.mocked(db);
  const mockSendEmail = vi.mocked(sendEmail);
  
  mockDb.returning.mockResolvedValue([{ id: 'user-123' }]);
  
  const result = await createUser({ email: 'test@example.com' });
  
  expect(mockDb.insert).toHaveBeenCalled();
  expect(mockSendEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'test@example.com' })
  );
  expect(result.id).toBe('user-123');
});
```

#### 2.3 エラーハンドリングの検証
```typescript
it('should handle database error', async () => {
  const mockDb = vi.mocked(db);
  mockDb.returning.mockRejectedValue(new Error('Connection failed'));
  
  await expect(createUser({ email: 'test@example.com' }))
    .rejects.toThrow('Connection failed');
});

it('should rollback on partial failure', async () => {
  // トランザクションのロールバック検証
});
```

#### 2.4 beforeEach でモックリセット
```typescript
describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  // tests...
});
```

### カバレッジ目標
- **API routers**: 70%+
- **主要サービス**: 80%+
- **エラーハンドリング**: 100%

---

### 実 DB テスト（`*.db.test.ts`）

モックでは確かめられないもの（マイグレーション、SQL の構文、ロック、トランザクション）は、実際の PostgreSQL に対して確認する。

- 置き場所: `test/unit/integration/*.db.test.ts`
- `TEST_DATABASE_URL` が設定されているときだけ実行される（未設定ならスキップ）
- CI では DB Integration Tests のジョブ（Postgres にマイグレーションを適用）で実行し、**失敗したらジョブを落とす**
- ローカルでの実行例:

```bash
docker run -d --name dl-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dl_test -p 55432:5432 pgvector/pgvector:pg16
# 0001 が使う拡張を先に有効にしておく
docker exec dl-test psql -U postgres -d dl_test -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS ltree;'
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test SKIP_ENV_VALIDATION=1 bun run db:migrate
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test bunx vitest --run test/unit/integration
```

- `.env.local` の `DATABASE_URL` は実環境（Supabase）を指していることがあるので、DB を使うコマンドでは必ず上書きする

## 3. E2E Tests

### 定義
**実環境**で、ユーザー視点のフロー全体をテスト

### 命名規則
```
*.spec.ts
```

### 対象
- 認証フロー（ログイン/登録/パスワードリセット）
- 診断フォーム送信
- リード管理（CRUD）
- 組織管理・切り替え
- ダッシュボード表示

### 原則

#### 3.1 ユーザー視点で記述
```typescript
// ❌ Bad: 実装詳細に依存
test('should set localStorage token', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('token', 'xxx'));
});

// ✅ Good: ユーザー操作で記述
test('user can login with valid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name="email"]', 'user@example.com');
  await page.fill('[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('h1')).toContainText('ダッシュボード');
});
```

#### 3.2 Page Object Model (POM)
```typescript
// pages/login.page.ts
export class LoginPage {
  constructor(private page: Page) {}
  
  async goto() {
    await this.page.goto('/login');
  }
  
  async login(email: string, password: string) {
    await this.page.fill('[name="email"]', email);
    await this.page.fill('[name="password"]', password);
    await this.page.click('button[type="submit"]');
  }
}

// tests/auth.spec.ts
test('user can login', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('user@example.com', 'password123');
  
  await expect(page).toHaveURL('/dashboard');
});
```

#### 3.3 テストデータの独立性
```typescript
test.beforeEach(async ({ page }) => {
  // テスト用ユーザーを作成
  await createTestUser({ email: `test-${Date.now()}@example.com` });
});

test.afterEach(async () => {
  // テストデータをクリーンアップ
  await cleanupTestData();
});
```

#### 3.4 待機戦略
```typescript
// ❌ Bad: 固定待機
await page.waitForTimeout(3000);

// ✅ Good: 要素の出現を待機
await page.waitForSelector('[data-testid="dashboard"]');
await expect(page.locator('h1')).toBeVisible();
```

#### 3.5 クリティカルパスのみ
```typescript
// E2Eでテストすべき: ユーザーの主要フロー
test('complete diagnostic form submission flow', async ({ page }) => {
  // 1. フォームにアクセス
  // 2. 質問に回答
  // 3. 送信
  // 4. 結果確認
  // 5. リード作成確認
});

// E2Eで不要: 細かいバリデーション（Unitでカバー）
```

### カバレッジ目標
- **クリティカルパス**: 100%
- **主要ユーザーフロー**: 100%
- **エッジケース**: Unitでカバー

---

## 層ごとのカバレッジ目標

品質をそろえるため、層ごとに目標を決めている（2026-02-06 の決定 `2026-02-06-coverage-by-layer`。CI のしきい値は `vitest.config.ts`）。

| 層 | 対象ディレクトリ | 目標 | テスト方法 |
|----|-----------------|------|-----------|
| Core | `lib/features/`, `lib/db/`, `lib/auth/` | 80% | ユニットテスト |
| API | `server/`, `app/api/` | 70% | ユニットテスト + 結合テスト |
| UI | `components/`, `app/[locale]/` | 30〜40% | コンポーネントテスト |
| E2E | 主なユーザーフロー | 主要フロー100% | Playwright |

テストの優先順位は、ビジネスロジック（`lib/features/`）→ データアクセス（`lib/db/`、ルーター）→ 認証・認可（`lib/auth/`）→ API（`app/api/`）→ UI（E2E で補う）。E2E で補う領域は、診断フォームの送信、ログイン・ログアウト、リードの一覧・詳細・編集、組織の切り替え、ダッシュボードの表示。長期の目標は全体 40% 以上（E2E を含めた実質 70% 以上）。

---

## テスト環境

### Unit / Integration
```bash
bun run test              # 全テスト
bun run test:coverage     # カバレッジ付き
bun run test -- --watch   # ウォッチモード
```

### E2E
```bash
# 環境起動
docker compose up -d

# テスト実行
bun run test:e2e

# UIモードで実行
bun run test:e2e -- --ui
```

- パスワードの再設定の E2E（`test/e2e/auth.spec.ts`）は、メールでしか届かないリンクのトークンを、アプリと同じ DB（`DATABASE_URL`）の `verification` の行から読む。自分専用のユーザーも DB に作って最後に消す（`test/e2e/helpers/database.ts`）
  - ユーザーを足し消しするので、`DATABASE_URL` が手元の DB（localhost・127.0.0.1・[::1]）のときだけ動く。それ以外は飛ばす。CI では飛ばさずに落とす。DB につなぐ関数（`connectE2EDatabase`）も、手元でない DB を渡されるとエラーにする
  - `DATABASE_URL` は、サーバーと同じ DB で、E2E の seed（`bun run test:e2e:seed`）を入れたものにする。違うと、ユーザーを作るところ（E2E の組織がない）か、トークンを読むところ（`found 0`）で落ちる
  - テストが Playwright のタイムアウトで止まると、後片付けが走らないことがあり、`e2e-reset-*@example.com` のユーザーが手元の DB に残る（消してよい。CI は毎回新しい DB を使う）

---

## CI/CD 統合

### 実行タイミング

| 種別 | PR | main |
|------|-----|------|
| Unit | ✅ | ✅ |
| Integration（実 DB） | ✅ | ✅ |
| E2E（CI では `@smoke` のテストだけ） | ✅ | ✅ |

`@smoke` の付かない E2E は CI では流れない。手元で `bun run test:e2e` を流して確かめる。

### 失敗時の対応

- GitHub が必須にしている検査（Lint & Type Check・Unit Tests ×4・DB Integration Tests・Build）が落ちると、マージできない
- E2E と Security Scan は必須ではない。緑を自分で確かめてからマージする（マージの条件はスキル `ship`）

---

## ベストプラクティス

### DO ✅
- テスト名は「should + 期待動作」で記述
- 1テスト1検証を守る
- テストデータは各テストで独立
- モックは最小限に
- エラーケースも必ずテスト

### DON'T ❌
- 実装詳細に依存したテスト
- 順序依存のテスト
- 外部サービスへの実接続（Unit/Integration）
- sleep/timeout での待機（E2E）
- スナップショットの過度な使用

---

## 関連ドキュメント

- [SprintPath](./SPRINTPATH.md) - アジャイル開発フレームワーク
- [CONTRIBUTING](../CONTRIBUTING.md) - 開発者ガイド
- [vitest.config.ts](../vitest.config.ts) - Vitest設定
- [playwright.config.ts](../playwright.config.ts) - Playwright設定

---

*最終更新: 2026-02-07*
