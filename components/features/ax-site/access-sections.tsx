import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { COLUMN_INDEX_PATH, columnPath, columnsFor } from '@/lib/features/ax-site/columns';
import { axResultEmailEnabled } from '@/lib/features/diagnostics/ax-migration/result-email-config';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  Check,
  CircleCheck,
  CirclePause,
  ExternalLink,
  Globe,
  HardDrive,
  Info,
  Package,
  Server,
  ShieldOff,
  UserRound,
  Wrench,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AxCrossLink } from './ax-cross-link';
import { AxCtaLink } from './ax-cta-link';
import { AxDiagnosisFrame } from './ax-landing-view';
import { ColumnBreadcrumbs } from './column-article';
import {
  CtaCaption,
  DiagnosisIntro,
  SECTION_HEADING,
  SECTION_LEAD,
  type SectionProps,
} from './landing-sections';
import {
  AX_HERO_CTA_ID,
  AX_PROBLEMS_CTA_ID,
  AX_SECTIONS,
  axConsultationUrl,
  axPrivacyPolicyUrl,
} from './site-config';

/**
 * Sections of the Access landing page (#296). It shares the frame, the header anchors
 * (AX_SECTIONS) and the look of the main landing page, the STUDIO design (#414, #425); the copy
 * lives in `axAccess`.
 */

const PATHS = [
  { key: 'fix', icon: Wrench },
  { key: 'web', icon: Globe },
  { key: 'replace', icon: Package },
] as const;

/** Text link to another page of the site: descriptive text, a touch target, the logo's outline */
const CROSS_LINK =
  'inline-flex items-start gap-1 rounded py-1 font-bold leading-relaxed text-ax-leaf underline underline-offset-4 hover:text-ax-forest focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-forest';
/** White icon on a forest square, as on the cards of the main page */
const ICON_TILE =
  'flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ax-forest text-white';

/** Where this page sits in the site, above the hero (#332) */
export async function AxAccessBreadcrumbs({ locale }: SectionProps) {
  const tc = await getTranslations({ locale, namespace: 'axColumn' });
  const t = await getTranslations({ locale, namespace: 'axAccess' });
  return (
    <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
      <ColumnBreadcrumbs
        items={[
          { name: tc('breadcrumbHome'), href: `/${locale}/ax-migration` },
          { name: t('breadcrumb') },
        ]}
        label={tc('breadcrumbLabel')}
        crossLinks
      />
    </div>
  );
}

const TRIGGER_KEYS = ['support', 'people', 'm365'] as const;

export async function AxAccessHero({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.hero' });
  const common = await getTranslations({ locale, namespace: 'axSite' });
  const consultationUrl = axConsultationUrl();

  return (
    <section aria-labelledby="ax-hero-heading" className="overflow-hidden bg-ax-forest text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
        <div className="space-y-6">
          <p className="text-sm font-bold tracking-wider text-ax-neon">{t('eyebrow')}</p>
          <h1
            id="ax-hero-heading"
            className="text-[1.75rem] font-bold leading-snug sm:text-4xl lg:text-[2.6rem] lg:leading-[1.35]"
          >
            {t('title')}
          </h1>
          <p className="leading-relaxed text-white/90">{t('lead')}</p>
          {/* What brings an Access tool up for review, ahead of the check, as on the main page */}
          <div>
            <p className="text-sm font-bold text-white/90">{t('triggersLabel')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {TRIGGER_KEYS.map((key) => (
                <li
                  key={key}
                  className="rounded border border-white/60 px-3 py-1.5 text-sm font-bold leading-snug"
                >
                  {t(`triggers.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 pt-2">
            <CtaCaption locale={locale}>{t('ctaCaption')}</CtaCaption>
            {/* The phone CTA bar watches the buttons, not the caption above them (#536) */}
            <div id={AX_HERO_CTA_ID} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="access-hero" tone="dark">
                {t('cta')}
              </AxCtaLink>
              {consultationUrl && (
                <AxCtaLink
                  href={consultationUrl}
                  variant="consultation"
                  location="access-hero"
                  tone="dark"
                  external
                  newTabLabel={common('newTab')}
                >
                  {t('consult')}
                </AxCtaLink>
              )}
            </div>
            <p className="text-sm leading-relaxed text-white/90">{t('pdfNote')}</p>
          </div>
        </div>

        {/* The three ways in place of the main page's picture */}
        <div className="mx-auto w-full max-w-md bg-white p-6 text-ax-ink sm:p-8">
          <p className="text-sm font-bold text-ax-leaf">{t('paths.title')}</p>
          <ul className="mt-4 space-y-3">
            {PATHS.map(({ key, icon: Icon }) => (
              <li key={key} className="flex items-center gap-4 bg-ax-cloud p-4">
                <span className={ICON_TILE}>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="font-bold">{t(`paths.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const SUPPORT_KEYS = ['le2013', 'v2016', 'v2021', 'm365'] as const;
/** Microsoft lifecycle pages the support-end facts come from */
const SUPPORT_SOURCES = [
  'https://learn.microsoft.com/lifecycle/products/office-ltsc-2021',
  'https://support.microsoft.com/KB/5002369',
] as const;

/** The column about the end of Office support, linked from that section */
const SUPPORT_END_COLUMN = 'access-office-support-end';

/** Facts with their source and date; no countdown (#158) */
export async function AxAccessSupportEnd({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.supportEnd' });
  const common = await getTranslations({ locale, namespace: 'axSite' });
  // The article on the support end only (the other Access columns are on the column list),
  // in the page's language only (they are Japanese for now, #324)
  const columns = columnsFor('access').filter(
    (column) => column.locale === locale && column.slug === SUPPORT_END_COLUMN
  );
  return (
    <section aria-labelledby="ax-access-support-heading" className="bg-white py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* A dated fact: set apart by the forest rule, not by a warning color */}
        <div className="border-t-4 border-ax-forest bg-ax-cloud p-6 sm:p-8">
          {/* The same heading as the box for AS/400 and ACOS readers */}
          <div className="flex items-center gap-3">
            <span className={ICON_TILE}>
              <Info className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 id="ax-access-support-heading" className="text-xl font-bold sm:text-2xl">
              {t('title')}
            </h2>
          </div>
          <ul className="mt-5 space-y-2">
            {SUPPORT_KEYS.map((key) => (
              <li key={key} className="flex gap-2 font-bold leading-relaxed">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-ax-forest" />
                <span>{t(`items.${key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed text-gray-700">{t('body')}</p>
          {/* The links side by side and at least 24px high, so a finger can pick either */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <p>{t('source')}</p>
            {SUPPORT_SOURCES.map((href, index) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-6 items-center gap-0.5 rounded underline underline-offset-2 hover:text-ax-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-forest"
              >
                {t('sourceLink', { number: index + 1 })}
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">{common('newTab')}</span>
              </a>
            ))}
          </div>
          {columns.length > 0 && (
            <div className="mt-6 border-t border-gray-300 pt-4">
              <p className="text-sm font-bold text-ax-leaf">{t('relatedColumn')}</p>
              <ul className="mt-2 space-y-2">
                {columns.map((column) => (
                  <li key={column.slug}>
                    <a href={`/${column.locale}${columnPath(column.slug)}`} className={CROSS_LINK}>
                      {column.title}
                      <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const PROBLEM_KEYS = ['m365', 'nobody', 'stability', 'remote', 'excel', 'control'] as const;

export async function AxAccessProblems({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.problems' });
  return (
    <section
      id={AX_SECTIONS.problems}
      aria-labelledby="ax-problems-heading"
      className="bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-problems-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEM_KEYS.map((key) => (
            <li key={key} className="flex gap-3 bg-white p-5 font-bold leading-relaxed sm:p-6">
              {/* A plain mark: a check next to a problem would read as "no problem" */}
              <span aria-hidden="true" className="mt-2.5 h-2 w-2 shrink-0 bg-ax-forest" />
              <span>{t(`items.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const RISKS = [
  { key: 'stop', icon: CirclePause },
  { key: 'support', icon: ShieldOff },
  { key: 'person', icon: UserRound },
  { key: 'data', icon: HardDrive },
] as const;

/** Moderate on purpose: never claims that moving to the web makes the data safe (#158) */
export async function AxAccessRisks({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.risks' });
  return (
    <section aria-labelledby="ax-access-risks-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-access-risks-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-12 grid gap-6 sm:grid-cols-2">
          {RISKS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4 bg-ax-cloud p-6 sm:p-8">
              <span className={ICON_TILE}>
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-bold">{t(`items.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {t(`items.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center font-bold leading-relaxed">{t('note')}</p>
      </div>
    </section>
  );
}

/** Cases each way fits, as many as the messages have */
const PATH_FITS = {
  fix: ['a', 'b', 'c', 'd'],
  web: ['a', 'b', 'c', 'd'],
  replace: ['a', 'b'],
} as const;

/** The three ways, compared honestly: the diagnosis points at the one that fits */
export async function AxAccessPaths({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.paths' });
  return (
    <section aria-labelledby="ax-access-paths-heading" className="bg-ax-mist py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-access-paths-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-12 grid gap-6 md:grid-cols-3">
          {PATHS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col bg-white">
              <div className="flex items-center gap-3 bg-ax-forest px-6 py-4 text-white">
                <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                <h3 className="text-lg font-bold">{t(`items.${key}.title`)}</h3>
              </div>
              <div className="flex flex-1 flex-col gap-5 p-6">
                <p className="text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
                {/* The green box of the main page's challenge cards */}
                <div className="flex-1 rounded bg-ax-leaf/10 p-4">
                  <p className="text-sm font-bold text-ax-leaf">{t('fitLabel')}</p>
                  <ul className="mt-3 space-y-2">
                    {PATH_FITS[key].map((fit) => (
                      <li key={fit} className="flex gap-2 text-sm font-bold leading-snug">
                        <CircleCheck className="h-5 w-5 shrink-0 text-ax-leaf" aria-hidden="true" />
                        <span>{t(`items.${key}.fits.${fit}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center font-bold leading-relaxed">{t('fixNote')}</p>
        {/* The phone CTA bar stays hidden next to this button, as below the concerns of the main page */}
        <div id={AX_PROBLEMS_CTA_ID} className="mt-8 text-center">
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="access-paths">
            {t('bridgeCta')}
          </AxCtaLink>
        </div>
      </div>
    </section>
  );
}

/** The column that compares the three ways in a table, after the section on them (#332) */
const PATHS_COLUMN = 'access-fix-or-web';

export async function AxAccessPathsColumn({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.pathsColumn' });
  // Articles are Japanese for now (#324): nothing to link to in another language
  const column = columnsFor('access').find(
    (item) => item.locale === locale && item.slug === PATHS_COLUMN
  );
  if (!column) return null;
  return (
    <div className="-mt-8 bg-ax-mist pb-16 sm:-mt-12 sm:pb-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="bg-white px-6 py-5 text-center">
          <p className="text-sm leading-relaxed text-gray-700">{t('lead')}</p>
          <AxCrossLink
            href={`/${column.locale}${columnPath(column.slug)}`}
            placement="paths"
            className={`mt-2 ${CROSS_LINK}`}
          >
            {column.title}
            <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </AxCrossLink>
        </div>
      </div>
    </div>
  );
}

/** The free check first, as on the main page, then the steps of an Access project */
const STEPS = ['web', 'inventory', 'decide', 'migrate', 'ax'] as const;

/** Timeline of the main page's steps: the lead stays in view next to it on wide screens */
export async function AxAccessSteps({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.steps' });
  return (
    <section
      id={AX_SECTIONS.steps}
      aria-labelledby="ax-steps-heading"
      className="bg-white py-16 sm:py-24"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 id="ax-steps-heading" className="text-2xl font-bold leading-snug sm:text-[2.25rem]">
            {t('title')}
          </h2>
          <p className="mt-5 text-sm leading-loose text-gray-700">{t('lead')}</p>
        </div>
        <ol>
          {STEPS.map((key, index) => (
            <li key={key} className="relative pb-10 pl-12 last:pb-0">
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-4 top-9 w-px bg-ax-ink/50"
                />
              )}
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-ax-ink bg-white"
              >
                <Check className="h-4 w-4" />
              </span>
              <p className="font-ax-latin text-sm font-bold text-ax-leaf">
                {t(`items.${key}.label`)}
              </p>
              <h3 className="mt-1 text-lg font-bold">{t(`items.${key}.title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
              {/* Where AI may come in, with the step that adds it */}
              {key === 'ax' && (
                <p className="mt-4 bg-ax-cloud p-4 text-sm leading-relaxed">{t('aiNote')}</p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const TARGET_KEYS = ['files', 'versions', 'vba', 'links', 'department'] as const;

/** The column on telling Access files apart, for readers who cannot tell which file is one (#367) */
const FILE_TYPES_COLUMN = 'access-file-types';

export async function AxAccessTargets({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.targets' });
  // Articles are Japanese for now (#324): no link in another language
  const fileTypes = columnsFor('access').find(
    (item) => item.locale === locale && item.slug === FILE_TYPES_COLUMN
  );
  return (
    <section
      id={AX_SECTIONS.targets}
      aria-labelledby="ax-targets-heading"
      className="bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-targets-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-10 space-y-3">
          {TARGET_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-3 bg-white px-5 py-4 font-bold">
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-ax-leaf" aria-hidden="true" />
              <span>{t(`items.${key}`)}</span>
            </li>
          ))}
        </ul>
        {fileTypes && (
          <p className="mt-6 text-center">
            <AxCrossLink
              href={`/${fileTypes.locale}${columnPath(fileTypes.slug)}`}
              placement="targets"
              className={CROSS_LINK}
            >
              {t('fileTypesLink')}
              <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
            </AxCrossLink>
          </p>
        )}
      </div>
    </section>
  );
}

const HOST_LINKS = [
  { key: 'as400', id: AX_SECTIONS.as400 },
  { key: 'acos', id: AX_SECTIONS.acos },
  { key: 'targets', id: AX_SECTIONS.targets },
] as const;

/**
 * For readers of AS/400 or ACOS who arrive here: the sections of the main page on their system,
 * instead of a dead end (#332)
 */
export async function AxAccessHostSystems({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.hosts' });
  return (
    <section aria-labelledby="ax-access-hosts-heading" className="bg-white py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="bg-ax-cloud p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className={ICON_TILE}>
              <Server className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 id="ax-access-hosts-heading" className="text-xl font-bold leading-snug sm:text-2xl">
              {t('title')}
            </h2>
          </div>
          <p className="mt-4 leading-relaxed text-gray-700">{t('lead')}</p>
          <ul className="mt-4 space-y-1">
            {HOST_LINKS.map(({ key, id }) => (
              <li key={key}>
                <AxCrossLink
                  href={`/${locale}/ax-migration#${id}`}
                  placement="hosts"
                  className={CROSS_LINK}
                >
                  {t(`links.${key}`)}
                  <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                </AxCrossLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The Access columns and the column list, at the end of the page (#332) */
export async function AxAccessColumns({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.columns' });
  // Articles are Japanese for now (#324): no section in another language
  const columns = columnsFor('access').filter((column) => column.locale === locale);
  if (columns.length === 0) return null;
  return (
    <section aria-labelledby="ax-access-columns-heading" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-access-columns-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ul className="mt-8 space-y-3">
          {columns.map((column) => (
            <li key={column.slug}>
              {/* The whole row is the link, as it looks like one */}
              <AxCrossLink
                href={`/${column.locale}${columnPath(column.slug)}`}
                placement="related"
                className={cn(
                  CROSS_LINK,
                  'w-full justify-between rounded-none bg-ax-cloud px-5 py-3 hover:bg-ax-leaf/10'
                )}
              >
                {column.title}
                <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
              </AxCrossLink>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center">
          <AxCrossLink
            href={`/${locale}${COLUMN_INDEX_PATH}`}
            placement="related"
            className={CROSS_LINK}
          >
            {t('all')}
            <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </AxCrossLink>
        </p>
      </div>
    </section>
  );
}

export const ACCESS_FAQ_KEYS = [
  'noDocs',
  'accde',
  'partial',
  'webSecurity',
  'cost',
  'period',
  'useDuring',
  'department',
  'consult',
] as const;

/** The diagnosis starts on the Access path; the submission records this page as its entry */
export async function AxAccessDiagnosisSection({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.diagnosis' });
  return (
    <AxDiagnosisFrame
      intro={<DiagnosisIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />}
      // The diagnosis opens on the Access questions; other systems are one step back, which
      // the note under its Back button says
      note={
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-gray-700">
          {t('presetNote')}
        </p>
      }
    >
      <AxDiagnosisFlow
        locale={locale}
        privacyPolicyUrl={axPrivacyPolicyUrl()}
        turnstileSiteKey={turnstileSiteKey()}
        allowedEmailDomains={allowedEmailDomains()}
        resultEmailEnabled={axResultEmailEnabled()}
        embedded
        initialPlatform="access"
        entry="ax-access-lp"
      />
    </AxDiagnosisFrame>
  );
}

/** Trademark notice of the page (the site frame has no place for notes) */
export async function AxAccessTrademark({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess' });
  return (
    <div className="bg-white">
      <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-gray-600 sm:px-6">
        {t('trademark')}
      </p>
    </div>
  );
}
