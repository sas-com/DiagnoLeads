'use client';

import { Callout } from '@/components/ui/callout';
import {
  type HelpArticle,
  type HelpBlock,
  type HelpInline,
  type HelpRole,
  helpInlineRuns,
} from '@/lib/features/help/types';
import { AlertTriangle, Lightbulb, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Renders a help article (Epic #877). Every text is rendered as text: an article cannot inject
 * markup. Links are paths of the admin app; the locale of the page is added here.
 */
export function HelpArticleView({
  article,
  onNavigate,
}: {
  article: HelpArticle;
  /** Called when a link of the article is followed (the panel closes) */
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground">
      {article.blocks.map((block, index) => (
        // Blocks are static data in a fixed order
        // biome-ignore lint/suspicious/noArrayIndexKey: the order of an article never changes
        <Block key={index} block={block} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function Block({ block, onNavigate }: { block: HelpBlock; onNavigate?: () => void }) {
  const t = useTranslations('help');
  const inline = (content: HelpInline) => <Inline content={content} onNavigate={onNavigate} />;
  switch (block.type) {
    case 'h2':
      return (
        <h2 id={block.id} className="pt-2 text-base font-bold">
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 id={block.id} className="font-semibold">
          {block.text}
        </h3>
      );
    case 'p':
      return <p>{inline(block.content)}</p>;
    case 'ul':
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="list-decimal space-y-1 pl-5">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <li key={index}>{inline(item)}</li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {block.header.map((cell) => (
                  <th key={cell} className="border-b px-2 py-1.5 font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static table
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static table
                    <td key={cellIndex} className="border-b px-2 py-1.5 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'note':
      return block.tone === 'caution' ? (
        <Callout title={t('caution')} icon={AlertTriangle} color="yellow">
          {inline(block.content)}
        </Callout>
      ) : (
        <Callout title={t('tip')} icon={Lightbulb} color="blue">
          {inline(block.content)}
        </Callout>
      );
    case 'roles':
      return (
        <Callout title={roleTitle(t, block.roles)} icon={Users} color="green">
          {inline(block.content)}
        </Callout>
      );
    case 'faq':
      return (
        <dl className="space-y-3">
          {block.items.map((item) => (
            <div key={item.question}>
              <dt className="font-semibold">{item.question}</dt>
              <dd className="mt-1">{inline(item.answer)}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

function roleTitle(t: ReturnType<typeof useTranslations<'help'>>, roles: HelpRole[]): string {
  return t('rolesTitle', { roles: roles.map((role) => t(`roles.${role}`)).join('・') });
}

function Inline({ content, onNavigate }: { content: HelpInline; onNavigate?: () => void }) {
  const locale = useLocale();
  const parts: ReactNode[] = helpInlineRuns(content).map((run, index) => {
    switch (run.type) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: runs of a static text
        return <span key={index}>{run.text}</span>;
      case 'strong':
        // biome-ignore lint/suspicious/noArrayIndexKey: runs of a static text
        return <strong key={index}>{run.text}</strong>;
      case 'ui':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs of a static text
          <span key={index} className="rounded bg-muted px-1 py-0.5 font-medium">
            {run.text}
          </span>
        );
      case 'link':
        return (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: runs of a static text
            key={index}
            href={`/${locale}${run.href}`}
            onClick={onNavigate}
            className="font-medium text-primary underline underline-offset-2"
          >
            {run.text}
          </Link>
        );
    }
  });
  return <>{parts}</>;
}
