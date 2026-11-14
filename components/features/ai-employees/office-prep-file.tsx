'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DealCard } from '@/lib/features/deals/service';
import { PREP_CHALLENGES } from '@/lib/features/lead-prep/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import { ROOM_BOARD, ROOM_FRAME, RoomChoiceButton } from './office-room-parts';
import {
  PREP_FILE_PARTS,
  type PrepFilePart,
  prepCardFilled,
  prepPartOfKey,
} from './rooms/survey-board';

/** A calendar day ('YYYY-MM-DD') as it is written on the board */
const dayText = (day: string) => day.replaceAll('-', '/');

const LINK = 'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white';

/**
 * A preparation file opened inside the engineering room (#1194): what is known about the customer
 * of a survey deal before the proposal is prepared. It reads the latest hearing as its summary
 * (`leadHandoff.get` names it, `leadHearings.summary` reads it) and the prep card of the first
 * meeting (`leadPrep.get`), the same records the lead's page and the handoff sheet show.
 *
 * The file only reads: the number keys turn to a part of the file and change nothing. Writing a
 * hearing or the card is done on the lead's page, which the links at the foot open.
 */
export function OfficePrepFile({
  organizationId,
  deal,
  header,
  guide,
  keysRef,
  onClose,
  onOpenNormal,
}: {
  organizationId: string;
  deal: DealCard;
  /** Whose room this is: shown over the report, like over the board */
  header: ReactNode;
  /** The line that says who holds the room, shown over the report like in the room */
  guide?: ReactNode;
  /** Filled with the file's key handler while the file is open */
  keysRef: MutableRefObject<RoomKeys | null>;
  onClose: () => void;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.engineering.file');
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tStages = useTranslations('deals.stages');
  const tPrep = useTranslations('leadPrep');
  const tChallenge = useTranslations('leadHearings.options.challenge');
  const tLead = useTranslations('leads');
  const locale = useLocale();
  const reportRef = useRef<HTMLDivElement>(null);
  const [part, setPart] = useState<PrepFilePart>(PREP_FILE_PARTS[0]);

  const scope = { organizationId, leadId: deal.leadId };
  const handoff = trpc.leadHandoff.get.useQuery(scope);
  const latest = handoff.data?.latestHearing ?? null;
  const hearing = trpc.leadHearings.summary.useQuery(
    { organizationId, id: latest?.id ?? '', locale: locale === 'en' ? 'en' : 'ja' },
    { enabled: latest !== null }
  );
  const prep = trpc.leadPrep.get.useQuery(scope);

  const company = deal.company || tLeads('noCompany');
  const summary = hearing.data?.summary;
  const card = prep.data?.card && prepCardFilled(prep.data.card) ? prep.data.card : null;
  const hearingFailed = handoff.isError || hearing.isError;
  const hearingForbidden =
    handoff.error?.data?.code === 'FORBIDDEN' || hearing.error?.data?.code === 'FORBIDDEN';
  const hearingReady = handoff.data !== undefined && (latest === null || summary !== undefined);

  // The report takes the focus when the file opens: Enter pressed once too often does nothing
  useEffect(() => {
    reportRef.current?.focus();
  }, []);

  // The file's keys: a number turns to a part of the file. Esc is the room's (it closes the file)
  const onFileKey: RoomKeys = (event) => {
    if (isImeKey(event)) return false;
    const chosen = prepPartOfKey(event.key);
    if (!chosen) return false;
    event.preventDefault();
    setPart(chosen);
    return true;
  };
  const latestKeys = useRef(onFileKey);
  latestKeys.current = onFileKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const reading = (
    <output className="flex items-center gap-3 text-sm text-[#d8d2c4]">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {t('reading')}
    </output>
  );

  return (
    <div className={ROOM_FRAME}>
      {/* What the records say about this customer, and what the president asks to see */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        <div ref={reportRef} tabIndex={-1} className="space-y-2 outline-none" aria-live="polite">
          {guide}
          <p className="text-base leading-relaxed font-medium">
            {hearingFailed
              ? t('hearingUnavailable')
              : !hearingReady
                ? t('reading')
                : summary
                  ? t('hearingLatest', {
                      date: dayText(summary.heldOn),
                      missing: summary.missing.length,
                      unconfirmed: summary.unconfirmed.length,
                      next: summary.next.length,
                    })
                  : t('noHearing')}
          </p>
          {prep.data && (
            <p className="text-sm leading-relaxed">{card ? t('prepReady') : t('prepNone')}</p>
          )}
          {handoff.data && (
            <p className="text-sm leading-relaxed text-[#d8d2c4]">
              {handoff.data.lead.handedOffOn
                ? t('handedOff', { date: dayText(handoff.data.lead.handedOffOn) })
                : t('notHandedOff')}
            </p>
          )}
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {PREP_FILE_PARTS.map((option, index) => (
            <li key={option}>
              <RoomChoiceButton
                keyCap={String(index + 1)}
                main={option === part}
                pressed={option === part}
                onClick={() => setPart(option)}
              >
                {t(`choices.${option}`)}
              </RoomChoiceButton>
            </li>
          ))}
          <li>
            <RoomChoiceButton keyCap="Esc" onClick={onClose}>
              {t('choices.back')}
            </RoomChoiceButton>
          </li>
        </ul>
      </div>

      {/* The file on the room's table */}
      <section aria-label={t('label', { company })} className={ROOM_BOARD}>
        <header className="border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <p className={CAP}>{t('title')}</p>
          <h2 className="truncate text-xl font-bold">
            {company}
            <span className="ml-3 text-base font-medium text-[#d8d2c4]">
              {deal.leadName || tLead('nameNotSet')}
            </span>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex rounded-full border border-[#e9cf9a] px-2.5 py-0.5 text-xs font-bold text-[#e9cf9a]">
              {tStages(deal.stage)}
            </span>
            <span className="truncate">{deal.name}</span>
            {/* Read out when the part changes: the file answers the choice on the left */}
            <output className="text-[#d8d2c4]">{t(`parts.${part}`)}</output>
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {part === 'hearing' ? (
            hearingForbidden ? (
              <p className="text-sm leading-relaxed">{t('hearingForbidden')}</p>
            ) : hearingFailed ? (
              <p className="text-sm leading-relaxed">{t('readError')}</p>
            ) : !hearingReady ? (
              reading
            ) : !summary ? (
              <p className="text-sm leading-relaxed text-[#d8d2c4]">{t('hearingEmpty')}</p>
            ) : (
              <>
                <p className="text-sm text-[#d8d2c4] tabular-nums">
                  {t('hearingOn', { date: dayText(summary.heldOn) })}
                </p>
                {summary.sections.map((section) => (
                  <section key={section.id} className="space-y-2">
                    <h3 className={CAP}>{section.title}</h3>
                    <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
                      {section.items.map((item) => (
                        <div key={item.key} className="min-w-0">
                          <dt className="text-xs text-[#bdb7a9]">{item.label}</dt>
                          <dd className="break-words whitespace-pre-wrap">
                            {item.value ?? (
                              <span className="text-[#d8d2c4]">{t('notRecorded')}</span>
                            )}
                            {(['missing', 'unconfirmed', 'next', 'changed'] as const)
                              .filter((flag) => item.flags[flag])
                              .map((flag) => (
                                <span
                                  key={flag}
                                  className="ml-2 inline-flex rounded-full border border-[#e9cf9a] px-2 py-0.5 text-xs font-bold whitespace-nowrap text-[#e9cf9a]"
                                >
                                  {t(`flags.${flag}`)}
                                </span>
                              ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </>
            )
          ) : prep.isError ? (
            <p className="text-sm leading-relaxed">{t('readError')}</p>
          ) : !prep.data ? (
            reading
          ) : !card ? (
            <p className="text-sm leading-relaxed text-[#d8d2c4]">{t('prepEmpty')}</p>
          ) : (
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs text-[#bdb7a9]">{tPrep('fields.estimatedSystem')}</dt>
                <dd className="break-words">
                  {card.estimatedSystem ?? (
                    <span className="text-[#d8d2c4]">{t('notRecorded')}</span>
                  )}
                  {card.estimatedSystemBasis && (
                    <span className="ml-2 text-[#d8d2c4]">
                      {tPrep('basisInline', { basis: card.estimatedSystemBasis })}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{tPrep('fields.recentNews')}</dt>
                <dd className="break-words whitespace-pre-wrap">
                  {card.recentNews ?? <span className="text-[#d8d2c4]">{t('notRecorded')}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{tPrep('fields.hypotheses')}</dt>
                <dd>
                  {PREP_CHALLENGES.some((challenge) => card.hypotheses[challenge]) ? (
                    <ul className="space-y-1">
                      {PREP_CHALLENGES.filter((challenge) => card.hypotheses[challenge]).map(
                        (challenge) => (
                          <li key={challenge} className="break-words">
                            <span className="font-bold">{tChallenge(challenge)}</span>：
                            {card.hypotheses[challenge]}
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <span className="text-[#d8d2c4]">{t('notRecorded')}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{tPrep('fields.firstQuestions')}</dt>
                <dd>
                  {card.firstQuestions.length > 0 ? (
                    <ol className="list-decimal space-y-1 pl-5">
                      {card.firstQuestions.map((question) => (
                        <li key={question} className="break-words">
                          {question}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="text-[#d8d2c4]">{t('notRecorded')}</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <p className="text-xs">{t('readOnlyHint')}</p>
          <div className="flex flex-wrap items-center gap-x-5">
            {latest && (
              <Link
                href={`/${locale}/leads/${deal.leadId}/handoff`}
                onClick={onOpenNormal}
                className={cn(LINK, FOCUS)}
              >
                {t('openHandoff')}
              </Link>
            )}
            <Link
              href={`/${locale}/leads/${deal.leadId}`}
              onClick={onOpenNormal}
              className={cn(LINK, FOCUS)}
            >
              {t('openLead')}
            </Link>
            <Link
              href={`/${locale}/deals/${deal.id}`}
              onClick={onOpenNormal}
              className={cn(LINK, FOCUS)}
            >
              {t('openDeal')}
            </Link>
          </div>
        </footer>
      </section>
    </div>
  );
}
