'use client';

import {
  AX_ACCESS_PATHS,
  type AxAccessPathResult,
} from '@/lib/features/diagnostics/ax-migration/access-path';
import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createElement } from 'react';

interface AccessPathSectionProps {
  accessPath: AxAccessPathResult;
  headingTag: 'h2' | 'h4';
  /** The follow-up questions have not been answered yet: they can sharpen the guide */
  showRefineHint: boolean;
}

/**
 * おすすめの進め方（目安） for an Access tool (#303): the recommended path with its reasons, the
 * other two in a line each, and a note that the path is decided together in the consultation
 */
export function AccessPathSection({
  accessPath,
  headingTag,
  showRefineHint,
}: AccessPathSectionProps) {
  const t = useTranslations('axDiagnosis.result.accessPath');
  const others = AX_ACCESS_PATHS.filter((path) => path !== accessPath.path);

  return (
    <section
      aria-labelledby="ax-result-access-path-heading"
      className="space-y-4 rounded-2xl border-2 border-ax-teal/30 bg-white p-6"
      data-testid="ax-result-access-path"
      data-path={accessPath.path}
    >
      {createElement(
        headingTag,
        {
          id: 'ax-result-access-path-heading',
          className: 'flex items-center gap-2 text-lg font-bold',
        },
        <Compass key="icon" className="h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />,
        t('title')
      )}

      <div
        className="space-y-3 rounded-xl bg-ax-teal/5 p-4"
        data-testid="ax-access-path-recommended"
      >
        <p className="text-xs font-bold text-ax-teal-dark">{t('recommended')}</p>
        <p className="text-xl font-bold">{t(`paths.${accessPath.path}.title`)}</p>
        <p className="text-sm leading-relaxed text-gray-700">
          {t(`paths.${accessPath.path}.body`)}
        </p>
        {accessPath.reasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-gray-700">{t('reasonsTitle')}</p>
            <ul className="space-y-1.5 text-sm leading-relaxed text-gray-800">
              {accessPath.reasons.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ax-teal-dark"
                  />
                  <span>{t(`reasons.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-600">{t('othersTitle')}</p>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="ax-access-path-others">
          {others.map((path) => (
            <li key={path} className="rounded-xl border border-gray-200 p-3 text-sm">
              <span className="block font-bold">{t(`paths.${path}.title`)}</span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-700">
                {t(`paths.${path}.short`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs leading-relaxed text-gray-700">{t('note')}</p>
      {showRefineHint && (
        <p className="text-xs leading-relaxed text-gray-700 print:hidden">{t('refineHint')}</p>
      )}
    </section>
  );
}
