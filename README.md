# DiagnoLeads

> 2026-10-09: 旧 `diagnoleads-v2` を `DiagnoLeads` に改名し、v1（FastAPI + React）をこのリポジトリに集約しました。
> v1 は [DiagnoLeads-v1-legacy](https://github.com/yusuke-kurosawa/DiagnoLeads-v1-legacy)（アーカイブ）として参照用に残しています。移植計画は #31。

AI-Powered B2B Diagnostic Platform for **Holdings, Group Companies & Enterprise Organizations**

> 🏢 **Our Core Competence**: Not just another multi-tenant SaaS.
> DiagnoLeads v2 is designed from the ground up to support **holding companies**, **corporate groups**, and **M&A scenarios** with hierarchical organization structures and cross-organizational insights.

## 🎯 What Makes Us Different

| Standard Multi-Tenant SaaS | DiagnoLeads v2 |
|---------------------------|----------------|
| ✅ Organization-level data isolation | ✅ Organization-level data isolation |
| ❌ Flat organization structure only | ✅ **Hierarchical organizations** (parent-subsidiary) |
| ❌ No cross-org collaboration | ✅ **Group-wide reporting & analytics** |
| ❌ Manual handling of M&A | ✅ **Built-in M&A support** with data migration |
| ❌ Single-org reports only | ✅ **Consolidated group dashboards** |

**Perfect for**:
- 🏢 Holding companies managing multiple subsidiaries
- 🌐 Corporate groups with complex structures
- 📈 Companies executing M&A strategies
- 🏗️ Enterprises with divisional/company systems

👉 **[Read our Multi-Tenant Strategy](./docs/MULTI_TENANT_STRATEGY.md)** for detailed architecture

## アクセス情報

- **本番**: https://diagnoleads-v2.vercel.app （Vercel。`/` は `/ja` へ転送。英語は `/en/…`）
- **テストモード中**（2026-10-29 の公開まで）: 社外のメールアドレスからは診断・相談を送れない。AX の2ページは検索エンジンに載らない。公開の準備と条件は #51
- パスワード・API キー・テスト用アカウント・DB の接続先は、このリポジトリに書かない

### 公開ページ（ログイン不要）

| ページ | URL | 備考 |
|---|---|---|
| AX マイグレーション LP | [/ja/ax-migration](https://diagnoleads-v2.vercel.app/ja/ax-migration) | |
| Access 版 LP | [/ja/ax-migration/access](https://diagnoleads-v2.vercel.app/ja/ax-migration/access) | |
| コラム一覧 | [/ja/ax-migration/column](https://diagnoleads-v2.vercel.app/ja/ax-migration/column) | 記事は `/ja/ax-migration/column/<slug>`（`lib/features/ax-site/columns/`） |
| AX 移行診断 | [/ja/ax-diagnosis](https://diagnoleads-v2.vercel.app/ja/ax-diagnosis) | 社員の紹介リンクは `?agency=<コード>` 付き（管理画面の「顧客探し」で出す） |
| 診断結果メールの確認 | `/ja/ax-diagnosis/email/confirm` | メールのボタンから開く。結果メールは本番ではオフ（#154） |
| 配信停止 | `/ja/email/unsubscribe` | メールのリンクから開く |
| 診断ビルダーで作った診断 | `/ja/d/<slug>` | 公開中の診断だけ表示 |
| 旧来の汎用診断 | `/ja/diagnostic` | AX 移行診断へ転送（#71） |
| ブログ・FAQ | [/ja/blog](https://diagnoleads-v2.vercel.app/ja/blog)・[/ja/faq](https://diagnoleads-v2.vercel.app/ja/faq) | |

### 管理画面（ログインが必要）

| 画面 | URL | 備考 |
|---|---|---|
| ログイン | [/ja/login](https://diagnoleads-v2.vercel.app/ja/login) | 新規登録は招待リンク（`/ja/invite/<token>`、48時間有効）からだけ。招待は組織の owner・admin が「設定 → メンバー」で出す |
| ダッシュボード | `/ja/dashboard` | |
| リード | `/ja/leads` | 詳細は `/ja/leads/<leadId>`（ヒアリング・引き継ぎ） |
| 顧客探し（AX） | `/ja/prospects` | 社員の記録・紹介リンク・営業への引き継ぎ |
| 分析 | `/ja/analytics` | |
| 設定 | `/ja/settings` | 組織・メンバー・紹介リンク（agency-links）・AX プレイブック・Webhook・QR キャンペーン・埋め込み・コンテンツ編集者 |
| コンテンツ（ブログ・FAQ の編集） | `/ja/content/blog`・`/ja/content/faqs` | 編集できるのはコンテンツ編集者（「設定 → コンテンツ編集者」で指定）だけ。`/admin` はダッシュボードへ転送 |

### API・運用

| 項目 | 場所 | 備考 |
|---|---|---|
| 死活確認 | [/api/health](https://diagnoleads-v2.vercel.app/api/health) | `{"status":"ok"}` を返す（DB は見ない） |
| 死活監視 | GitHub Actions「Uptime」（`.github/workflows/uptime.yml`） | 10分ごとに本番を確かめ、落ちたら `uptime` ラベルの Issue を立てる（#364） |
| エラー通知 | `lib/ops/alert.ts` | サーバーエラーと、公開フォームでボットを断った回数が多いときに `OPS_ALERT_EMAIL` へメール（#227・#351） |
| 埋め込み API | `/api/embed/v1/*` | 停止中（404）。`EMBED_API_ENABLED=true` で有効になる（#293） |
| ホスティング | Vercel（プロジェクト `diagnoleads-v2`） | 環境変数は Vercel で管理。閲覧には権限が必要 |
| データベース | Supabase（PostgreSQL） | 本番へのマイグレーションの適用はオーナーが行う |
| 本番 DB の戻し手順 | [docs/runbooks/database-restore.md](./docs/runbooks/database-restore.md) | |
| 個人情報保護方針 | https://sas-com.com/privacy/ | AX の診断と LP からリンク |

## Quick Start

```bash
# Install dependencies
bun install

# Start Docker services
docker-compose up -d

# Run development server
bun run dev
```

Visit http://localhost:3000

## Production Deployment

For production deployment instructions, see [docs/deployment-guide.md](./docs/deployment-guide.md).

### Quick Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yusuke-kurosawa/DiagnoLeads)

```bash
# Using Vercel CLI
vercel --prod
```

## Tech Stack

- **Framework**: Next.js 15 + React 19
- **Language**: TypeScript 5.7+
- **Styling**: Tailwind CSS 4.0
- **Database**: PostgreSQL + Drizzle ORM
- **API**: tRPC + Server Actions
- **State Management**: Zustand + nuqs
- **Testing**: Vitest + Playwright
- **Code Quality**: Biome + lefthook
- **Package Manager**: Bun
- **Deployment**: Vercel
- **Monitoring**: Sentry

## Available Scripts

```bash
# Development
bun run dev              # Start dev server with Turbopack
bun run build            # Build for production
bun start               # Start production server

# Code Quality
bun run lint            # Run Biome linter
bun run format          # Format code with Biome
bun run typecheck       # TypeScript type checking

# Testing
bun test               # Run unit tests (Vitest)
bun run test:e2e        # Run E2E tests (Playwright)

# Database
bun run db:generate     # Generate Drizzle migrations
bun run db:push         # Push schema to database
bun run db:studio       # Open Drizzle Studio GUI

# Backup (Production)
./scripts/backup-database.sh   # Backup database
./scripts/restore-database.sh  # Restore from backup
```

## Development Services

| Service | URL | Credentials |
|---------|-----|-------------|
| Next.js App | http://localhost:3000 | - |
| PgAdmin | http://localhost:5050 | admin@diagnoleads.local / admin |
| Mailhog | http://localhost:8025 | - |
| Drizzle Studio | http://localhost:4983 | Run `npm run db:studio` |

## Project Structure

```
diagnoleads-v2/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication pages
│   ├── (marketing)/       # Marketing pages
│   ├── (app)/             # Main application
│   ├── api/               # API routes
│   └── actions/           # Server Actions
├── components/            # React components
│   ├── ui/               # UI components (shadcn/ui)
│   └── features/         # Feature components
│       └── leads/        # Lead management components
├── hooks/                 # 🆕 React hooks
│   ├── use-leads.ts      # Lead data hooks
│   └── use-organization.ts # Organization context
├── lib/                   # Utilities & configs
│   ├── db/               # Database schema & client
│   ├── multi-tenant/     # 🆕 Multi-tenant logic
│   │   ├── middleware/   # Organization middleware
│   │   ├── helpers/      # Membership helpers
│   │   └── types.ts      # Multi-tenant types
│   ├── features/         # 🆕 Feature-based modules
│   │   └── leads/        # Lead management
│   │       ├── api/      # tRPC router
│   │       └── types/    # Schemas & types
│   ├── trpc/             # tRPC configuration
│   ├── validation/       # Zod schemas
│   ├── types/            # TypeScript types
│   └── utils/            # Helper functions
├── server/                # tRPC server
│   └── routers/          # API routers
├── docs/                  # 📚 Documentation
│   ├── MULTI_TENANT_STRATEGY.md  # 🆕 Holdings/Group strategy
│   └── DIRECTORY_IMPROVEMENT_PLAN.md
├── openspec/              # 📋 OpenSpec-driven development
│   ├── specs/            # Architecture specs (Source of Truth)
│   └── changes/          # Change proposals
├── test/                  # Tests
│   ├── unit/             # Unit tests
│   │   ├── trpc/         # tRPC middleware tests
│   │   └── features/     # Feature tests
│   ├── integration/      # Integration tests
│   └── e2e/              # E2E tests
└── public/                # Static assets
```

## 🌐 Internationalization (i18n)

DiagnoLeads v2 supports multiple languages with comprehensive i18n infrastructure.

### Supported Languages

- 🇯🇵 Japanese (`ja`)
- 🇺🇸 English (`en`)

### Directory Structure

```
diagnoleads-v2/
├── locales/                # Translation files
│   ├── ja/                # Japanese translations
│   │   ├── common.json    # Common UI strings
│   │   └── errors.json    # Error messages
│   └── en/                # English translations
│       ├── common.json
│       └── errors.json
├── lib/
│   ├── i18n/              # i18n configuration
│   │   ├── config.ts      # next-intl config
│   │   ├── middleware.ts  # Locale detection
│   │   └── request.ts     # Server-side i18n
│   └── messages/          # Message utilities
│       ├── error-mapper.ts    # Error code → i18n key mapping
│       └── validation.ts      # Zod validation i18n
└── app/[locale]/          # Locale-based routing
```

### Error Message Localization

All error messages are centrally managed in `locales/*/errors.json`:

```typescript
// Example: Using localized error messages
import { useTranslations } from 'next-intl';
import { getLocalizedErrorMessage } from '@/lib/messages/error-mapper';

function MyComponent() {
  const tErrors = useTranslations('errors');

  try {
    // API call
  } catch (error) {
    const errorResponse = await mapFetchErrorToErrorResponse(error);
    const message = getLocalizedErrorMessage(errorResponse, tErrors);
    toast.error(message);
  }
}
```

### Zod Validation Localization

Zod validation errors are automatically localized:

```typescript
import { useTranslations } from 'next-intl';
import { createZodErrorMap } from '@/lib/messages/validation';
import { z } from 'zod';

function MyForm() {
  const tErrors = useTranslations('errors');
  const tFields = useTranslations('leads');

  // Set Zod error map for i18n
  z.setErrorMap(createZodErrorMap(tErrors, tFields));

  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(2).max(100),
  });

  // Errors will be automatically localized
}
```

### Usage Examples

#### 1. Basic Translation

```typescript
import { useTranslations } from 'next-intl';

function MyComponent() {
  const t = useTranslations('leads');

  return <h1>{t('title')}</h1>; // "リード管理" (ja) or "Lead Management" (en)
}
```

#### 2. Parameterized Messages

```typescript
const t = useTranslations('errors');

// {field} will be replaced with actual field name
const message = t('validation.required', { field: 'Email' });
// "Emailは必須です" (ja) or "Email is required" (en)
```

#### 3. Multiple Namespaces

```typescript
function Dashboard() {
  const t = useTranslations('dashboard');
  const tStatus = useTranslations('status');

  return (
    <>
      <h1>{t('title')}</h1>
      <span>{tStatus('new')}</span> {/* Status labels */}
    </>
  );
}
```

#### 4. Toast Notifications

```typescript
import { getToastMessageKey } from '@/lib/messages/error-mapper';

const tToast = useTranslations('errors');
const key = getToastMessageKey('create', 'lead', false);
toast.success(tToast(key)); // "リードを作成しました" (ja)
```

### Best Practices

1. **Always use translation keys** - Never hardcode user-facing strings
2. **Use parameterized messages** - For dynamic content (field names, counts, etc.)
3. **Namespace organization** - Group related translations (leads, dashboard, errors)
4. **Error handling** - Use `getLocalizedErrorMessage()` for consistent error display
5. **Date formatting** - Use locale-aware date-fns functions

```typescript
// ✅ Good - locale-aware date formatting
import { useLocale } from 'next-intl';
import { format } from 'date-fns';
import { ja, enUS } from 'date-fns/locale';

const locale = useLocale();
const dateLocale = locale === 'ja' ? ja : enUS;
format(date, 'PPP', { locale: dateLocale });

// ❌ Bad - hardcoded Japanese
format(date, 'yyyy年MM月dd日');
```

### Language Switching

Language preferences are stored in cookies and automatically applied:

```typescript
// Language switching is handled by LanguageSwitcher component
import { LanguageSwitcher } from '@/components/i18n/language-switcher';

<LanguageSwitcher /> // Displays language dropdown
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/diagnoleads_dev"
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Setup Documentation

For detailed setup instructions, see [docs/v2-setup/](./docs/v2-setup/):
- `QUICK_START.md` - Quick 15-minute setup guide
- `SETUP_GUIDE.md` - Comprehensive setup documentation
- `setup.sh` - Automated setup script

## Git Workflow

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with automatic validation:

```bash
# Commit format
<type>(<scope>): <description>

# Examples
feat(auth): add user authentication
fix(db): resolve connection pooling issue
docs(readme): update setup instructions
```

**Available scopes**: auth, leads, assessments, analytics, ai, db, api, ui, embed, integrations, email, jobs, i18n, seo, ci, deps, config, docs, test

## Documentation

- [Deployment Guide](./docs/deployment-guide.md) - Production deployment instructions
- [Backup Strategy](./docs/backup-strategy.md) - Database backup and recovery (general, 2026-01)
- [Database Restore Runbook](./docs/runbooks/database-restore.md) - Restoring the production database (Supabase)
- [Multi-Tenant Strategy](./docs/MULTI_TENANT_STRATEGY.md) - Holdings/Group architecture
- [Implementation Checklist](./IMPLEMENTATION_CHECKLIST.md) - Development progress

## License

Proprietary - DiagnoLeads Team
