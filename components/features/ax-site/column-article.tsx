import {
  type ColumnBlock,
  type Inline,
  inlineRuns,
  isAllowedHref,
  isExternalHref,
} from '@/lib/features/ax-site/columns';
import { isLandingHref } from '@/lib/features/ax-site/cross-links';
import { ChevronRight, ExternalLink, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { AxCrossLink } from './ax-cross-link';

/**
 * Renderer of the column articles (#324). Every text goes through React as text, never as HTML,
 * and a link is only rendered for a site path or an https URL (the content tests check them all).
 */

export interface ColumnLabels {
  /** Heading of the sources block ("出典") */
  sources: string;
  /** Screen reader note after a link that opens a new tab */
  newTab: string;
}

/** Id of the heading the sources block adds */
export const COLUMN_SOURCES_ID = 'sources';

const LINK = 'font-bold text-ax-teal-dark underline underline-offset-4 hover:text-ax-deep';

function ColumnLink({
  href,
  labels,
  children,
}: { href: string; labels: ColumnLabels; children: ReactNode }) {
  // Refused links are shown as their text (validateColumn keeps them out of the content)
  if (!isAllowedHref(href)) return <>{children}</>;
  // A link to a landing page or the diagnosis is measured as a move between pages (#332)
  if (isLandingHref(href)) {
    return (
      <AxCrossLink href={href} placement="body" className={LINK}>
        {children}
      </AxCrossLink>
    );
  }
  if (!isExternalHref(href)) {
    return (
      <a href={href} className={LINK}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <ExternalLink className="ml-0.5 inline h-3.5 w-3.5 align-[-0.1em]" aria-hidden="true" />
      <span className="sr-only">{labels.newTab}</span>
    </a>
  );
}

function InlineContent({ content, labels }: { content: Inline; labels: ColumnLabels }) {
  return (
    <>
      {inlineRuns(content).map((run, index) => {
        const key = `${index}-${run.type}`;
        switch (run.type) {
          case 'text':
            return <span key={key}>{run.text}</span>;
          case 'strong':
            return (
              <strong key={key} className="font-bold">
                {run.text}
              </strong>
            );
          case 'code':
            return (
              <code key={key} className="rounded bg-ax-mist px-1.5 py-0.5 font-mono text-[0.9em]">
                {run.text}
              </code>
            );
          case 'link':
            return (
              <ColumnLink key={key} href={run.href} labels={labels}>
                {run.text}
              </ColumnLink>
            );
        }
      })}
    </>
  );
}

const H2 = 'mt-14 border-l-4 border-ax-teal-dark pl-4 text-xl font-bold leading-snug sm:text-2xl';
const H3 = 'mt-10 text-lg font-bold leading-snug sm:text-xl';

function Block({ block, labels }: { block: ColumnBlock; labels: ColumnLabels }) {
  switch (block.type) {
    case 'h2':
      return (
        <h2 id={block.id} className={H2}>
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 id={block.id} className={H3}>
          {block.text}
        </h3>
      );
    case 'p':
      return (
        <p className="mt-5">
          <InlineContent content={block.content} labels={labels} />
        </p>
      );
    case 'ul':
      return (
        <ul className="mt-5 list-disc space-y-2 pl-6 marker:text-ax-teal-dark">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static article content
            <li key={index}>
              <InlineContent content={item} labels={labels} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="mt-5 list-decimal space-y-2 pl-6 marker:font-bold marker:text-ax-teal-dark">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static article content
            <li key={index}>
              <InlineContent content={item} labels={labels} />
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        // Scrolls on its own on narrow screens rather than widening the page
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm leading-relaxed sm:text-base">
            <thead>
              <tr>
                {block.header.map((cell) => (
                  <th
                    key={cell}
                    scope="col"
                    className="border border-gray-300 bg-ax-teal-dark px-3 py-2 font-bold text-white"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static article content
                <tr key={rowIndex} className="even:bg-ax-mist">
                  {row.map((cell, cellIndex) =>
                    cellIndex === 0 ? (
                      <th
                        // biome-ignore lint/suspicious/noArrayIndexKey: static article content
                        key={cellIndex}
                        scope="row"
                        className="border border-gray-300 px-3 py-2 font-bold"
                      >
                        {cell}
                      </th>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static article content
                      <td key={cellIndex} className="border border-gray-300 px-3 py-2">
                        {cell}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout':
      return (
        <aside className="mt-6 flex gap-3 rounded-2xl border border-ax-teal/40 bg-ax-mist px-5 py-4 font-bold">
          <Info className="mt-1 h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />
          <p>
            <InlineContent content={block.content} labels={labels} />
          </p>
        </aside>
      );
    case 'sources':
      return (
        <section
          aria-labelledby={COLUMN_SOURCES_ID}
          className="mt-14 border-t border-gray-200 pt-2"
        >
          <h2 id={COLUMN_SOURCES_ID} className={H2}>
            {labels.sources}
          </h2>
          <ul className="mt-5 space-y-3 text-sm leading-relaxed">
            {block.items.map((item) => (
              <li key={item.href}>
                <ColumnLink href={item.href} labels={labels}>
                  {item.title}
                </ColumnLink>
                <span className="block break-all text-xs text-gray-600">{item.href}</span>
              </li>
            ))}
          </ul>
          {block.notes.map((note) => (
            <p key={note} className="mt-3 text-sm text-gray-700">
              {note}
            </p>
          ))}
        </section>
      );
  }
}

/** Body of an article: its blocks in order */
export function ColumnBody({ blocks, labels }: { blocks: ColumnBlock[]; labels: ColumnLabels }) {
  return (
    <div className="leading-[1.9]">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static article content
        <Block key={index} block={block} labels={labels} />
      ))}
    </div>
  );
}

/** Table of contents: the h2 headings, and the sources heading when there is one */
export function columnToc(
  blocks: ColumnBlock[],
  sourcesLabel: string
): { id: string; text: string }[] {
  return blocks.flatMap((block) => {
    if (block.type === 'h2') return [{ id: block.id, text: block.text }];
    if (block.type === 'sources') return [{ id: COLUMN_SOURCES_ID, text: sourcesLabel }];
    return [];
  });
}

export function ColumnToc({
  items,
  label,
}: {
  items: { id: string; text: string }[];
  label: string;
}) {
  return (
    <nav aria-labelledby="column-toc-heading" className="mt-8 rounded-2xl bg-ax-mist px-5 py-4">
      <h2 id="column-toc-heading" className="text-sm font-bold text-ax-teal-dark">
        {label}
      </h2>
      <ol className="mt-2 space-y-1.5 text-sm leading-relaxed">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="underline-offset-4 hover:text-ax-teal-dark hover:underline"
            >
              {item.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface Crumb {
  name: string;
  /** Absent for the current page */
  href?: string;
}

const CRUMB_LINK =
  'inline-block rounded py-1 underline underline-offset-4 hover:text-ax-teal-dark focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark';

interface ColumnBreadcrumbsProps {
  items: Crumb[];
  label: string;
  /** Measure the links as moves between pages (e.g. on the Access landing page, #332) */
  crossLinks?: boolean;
}

export function ColumnBreadcrumbs({ items, label, crossLinks = false }: ColumnBreadcrumbsProps) {
  return (
    <nav aria-label={label} className="text-xs text-gray-600 sm:text-sm">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {items.map((item, index) => (
          <li key={item.name} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {item.href && crossLinks ? (
              <AxCrossLink href={item.href} placement="breadcrumb" className={CRUMB_LINK}>
                {item.name}
              </AxCrossLink>
            ) : item.href ? (
              <a href={item.href} className={CRUMB_LINK}>
                {item.name}
              </a>
            ) : (
              <span aria-current="page">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Structured data (JSON-LD). A data block: the browser never runs it, so the CSP (nonce,
 * 'strict-dynamic') does not apply. React writes the string as is and breaks up "</script";
 * "<" is escaped as well so that no text of the content can close the element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json">{JSON.stringify(data).replace(/</g, '\\u003c')}</script>
  );
}
