import { HelpArticlePage } from '@/components/features/help/help-article-page';
import { helpArticleById } from '@/lib/features/help/articles';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

interface HelpArticleRouteProps {
  params: Promise<{ locale: string; articleId: string }>;
}

export async function generateMetadata({ params }: HelpArticleRouteProps) {
  const { locale, articleId } = await params;
  const t = await getTranslations({ locale, namespace: 'help.center' });
  const article = helpArticleById(articleId);
  return { title: `${article?.title ?? t('articleNotFound')} - DiagnoLeads` };
}

/** One article of the help center (Epic #877, #874) */
export default async function HelpArticleRoute({ params }: HelpArticleRouteProps) {
  const { articleId } = await params;
  const article = helpArticleById(articleId);
  if (!article) notFound();
  return <HelpArticlePage article={article} />;
}
