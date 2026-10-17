import { AppToaster } from '@/components/common/AppToaster';
import { NOINDEX } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

/**
 * Public Pages Layout
 *
 * 公開ページ用レイアウト（ランディングページ、診断フォームなど）
 * - SEO最適化
 * - OGP設定
 * - 認証不要
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'public.meta' });

  return {
    title: {
      template: '%s | DiagnoLeads',
      default: t('title'),
    },
    description: t('description'),
    keywords: t('keywords'),
    authors: [{ name: 'DiagnoLeads' }],
    creator: 'DiagnoLeads',
    openGraph: {
      type: 'website',
      locale: locale === 'ja' ? 'ja_JP' : 'en_US',
      url: process.env.NEXT_PUBLIC_APP_URL,
      siteName: 'DiagnoLeads',
      title: t('ogTitle'),
      description: t('ogDescription'),
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: 'DiagnoLeads - AI-Powered B2B Diagnostic Platform',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('ogTitle'),
      description: t('ogDescription'),
      images: ['/og-image.png'],
    },
    // Only the AX pages are ever indexed (lib/seo/indexing.ts)
    robots: NOINDEX,
  };
}

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The whole catalog for the client components (the locale layout passes only a small part)
  return (
    <NextIntlClientProvider>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">{children}</div>
      <AppToaster />
    </NextIntlClientProvider>
  );
}
