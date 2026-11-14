import { supportedLocaleOr } from '@/lib/i18n/config';
import { redirect } from 'next/navigation';

/**
 * The dashboard became part of 今日 and of the analytics page (#1164, decision
 * 2026-11-14-navigation-one-path): what the team acts on is at the top of 今日, the figures to
 * look back on are on the analytics page. Old links and bookmarks land on 今日.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${supportedLocaleOr(locale)}/today`);
}
