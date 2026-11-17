'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DealCard } from '@/lib/features/deals/service';
import { buildPrepDraft, hasDraftMaterial, prepCardFilled } from '@/lib/features/lead-prep/draft';
import { PREP_CHALLENGES, type PrepCardFields } from '@/lib/features/lead-prep/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, PANEL } from './office-hud';
import type { RoomKeys } from './office-room-contract';
import { ROOM_BOARD, ROOM_FRAME, RoomChoiceButton } from './office-room-parts';
import {
  PREP_FILE_KEYS,
  PREP_FILE_PARTS,
  type PrepFileAction,
  type PrepFilePart,
  prepActionOfKey,
  prepActionOpen,
  prepCardFields,
  prepPartOfKey,
  samePrepCard,
  savedPrepCard,
} from './rooms/survey-board';
import { useRoomKeys } from './use-room-keys';

type Outcome =
  // before: the card as the server held it right before the draft, which the undo puts back.
  // after: the draft as the server stores it; the undo is only taken while the card still says that. undoFailed: the undo did not go
  // through, so the draft is still saved and can be undone again
  | { kind: 'drafted'; before: PrepCardFields; after: PrepCardFields; undoFailed?: boolean }
  | { kind: 'undone' }
  // The server refused the draft: the card was saved in the moment after it was read.
  // fillable: whether the card as it is now still has a field a draft could fill
  | { kind: 'refused'; fillable: boolean }
  | { kind: 'failed' };

/** A calendar day ('YYYY-MM-DD') as it is written on the board */
const dayText = (day: string) => day.replaceAll('-', '/');

const LINK = 'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white';

/**
 * A preparation file opened inside the engineering room (#1194): what is known about the customer
 * of a survey deal before the proposal is prepared. It reads the latest hearing as its summary
 * (`leadHandoff.get` names it, `leadHearings.summary` reads it) and the prep card of the first
 * meeting (`leadPrep.get`), the same records the lead's page and the handoff sheet show.
 *
 * The number keys 1 and 2 turn to a part of the file and change nothing. One answer changes
 * something (#1212): the president can have the prep card drafted, the same way the lead's page
 * drafts it (`buildPrepDraft`: the empty fields are filled from the Web diagnosis and the sales
 * playbook, what somebody wrote is kept, Claude is not called) and saved with the page's own API
 * (`leadPrep.save`). It is carried out at once, so it can be undone: the undo saves the card back
 * as it was before. Both read the card again first and work from that, never from the card on
 * the screen: the save replaces the whole card, and somebody may have written to it since (#1221). Nothing here is the work of the AI engineer, and the file never says so.
 * Writing a hearing or editing the card field by field is done on the lead's page, which the
 * links at the foot open.
 */
export function OfficePrepFile({
  organizationId,
  deal,
  header,
  guide,
  keysRef,
  onClose,
  onOpenNormal,
  onBusyChange,
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
  /** Told while the card is read and saved for an answer, and when it no longer is */
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.engineering.file');
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tStages = useTranslations('deals.stages');
  const tPrep = useTranslations('leadPrep');
  const tChallenge = useTranslations('leadHearings.options.challenge');
  const tLead = useTranslations('leads');
  const tAll = useTranslations();
  const locale = useLocale();
  const utils = trpc.useUtils();
  const reportRef = useRef<HTMLDivElement>(null);
  const [part, setPart] = useState<PrepFilePart>(PREP_FILE_PARTS[0]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const scope = { organizationId, leadId: deal.leadId };
  const handoff = trpc.leadHandoff.get.useQuery(scope);
  const latest = handoff.data?.latestHearing ?? null;
  const hearing = trpc.leadHearings.summary.useQuery(
    { organizationId, id: latest?.id ?? '', locale: locale === 'en' ? 'en' : 'ja' },
    { enabled: latest !== null }
  );
  // Always read when the file opens (the app's default keeps an answer for five minutes): the
  // card the file shows, and starts from, is not one somebody else has changed since (#1221)
  const prep = trpc.leadPrep.get.useQuery(scope, { staleTime: 0 });

  const company = deal.company || tLeads('noCompany');
  const summary = hearing.data?.summary;
  const card = prep.data?.card && prepCardFilled(prep.data.card) ? prep.data.card : null;
  const hearingFailed = handoff.isError || hearing.isError;
  const hearingForbidden =
    handoff.error?.data?.code === 'FORBIDDEN' || hearing.error?.data?.code === 'FORBIDDEN';
  const hearingReady = handoff.data !== undefined && (latest === null || summary !== undefined);

  // The draft: the empty fields of the card as it was read, filled from what the API hands out
  // for it (only to those who may change the card)
  const canEdit = prep.data?.canEdit === true;
  const source = prep.data?.draftSource ?? null;
  const current = prepCardFields(prep.data?.card);
  const drafted = outcome?.kind === 'drafted';
  const material = source !== null && hasDraftMaterial(source);
  const draft =
    source && material ? buildPrepDraft(current, source, (key, values) => tAll(key, values)) : null;
  const fillable = draft !== null && !samePrepCard(current, draft);

  // The lead's page shows the same card. Asked for here and not in the answers below: this still
  // runs when the file was closed (a link at the foot) before the save came back
  const save = trpc.leadPrep.save.useMutation({
    onSuccess: () => void utils.leadPrep.get.invalidate(scope),
    // Sent at once also while the browser says it is offline: by default a save then waits,
    // without failing, for the network to come back, and "working" would never end. This way
    // it fails, and the file says so (#1232, the first way out named in #1251)
    networkMode: 'always',
  });
  // An answer first reads the card again, then saves: both count as working on it
  const [checking, setChecking] = useState(false);
  const working = checking || save.isPending;
  // The office keeps the room open meanwhile: its own way back to the floor (the button at the
  // top right) would otherwise close the file under an answer that is on its way (#1232)
  useEffect(() => {
    onBusyChange(working);
    return () => onBusyChange(false);
  }, [working, onBusyChange]);
  // While the card is read again, nothing is taken: an answer would start from an old card
  const rereading = prep.isFetching === true;
  // Somebody changed the card after the draft (on the lead's page): putting the old card back
  // would wipe what they wrote, so the undo is closed and the file says why
  const stale = outcome?.kind === 'drafted' && !rereading && !samePrepCard(current, outcome.after);
  const state = { canEdit, drafted, busy: working || rereading, fillable, stale };

  /**
   * The card as the server holds it right now (#1221). `leadPrep.save` replaces the whole card,
   * so an answer never starts from the card on the screen, which somebody may have changed on
   * the lead's page since it was read: it reads the card again and works from that. The save
   * carries the `updatedAt` of that read (#1225), so a card saved in the moment between the read
   * and the save is not written over either: the server refuses, and the file says so.
   */
  // Not tried again: while it runs, Esc and the way back are closed
  // ...and not left waiting while offline either (networkMode, like the save)
  const readNow = () =>
    utils.leadPrep.get.fetch(scope, { staleTime: 0, retry: false, networkMode: 'always' });
  // The file can be left while the card is read (a link at the foot): then nothing is saved
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  /** The card a draft would save from what the server holds now; null when nothing is to fill */
  const draftOf = (fresh: Awaited<ReturnType<typeof readNow>>) => {
    const now = prepCardFields(fresh.card);
    const filled =
      fresh.canEdit && fresh.draftSource && hasDraftMaterial(fresh.draftSource)
        ? savedPrepCard(buildPrepDraft(now, fresh.draftSource, (key, values) => tAll(key, values)))
        : null;
    return filled && !samePrepCard(now, filled) ? filled : null;
  };
  /**
   * The server refused a save (#1225): the card was saved from another screen in the moment
   * after it was read. Before anything is said, the card is read once more, so that what the
   * file says is true of the card as it is: it never says "ask again" over a card that has
   * nothing left to fill, or "undo again" over a card whose content changed.
   */
  const afterRefusal = async (action: PrepFileAction) => {
    setChecking(true);
    try {
      const fresh = await readNow();
      if (!shown.current) return;
      if (action === 'draft') setOutcome({ kind: 'refused', fillable: draftOf(fresh) !== null });
      // The undo: when the content changed, the file says so by itself (stale); when only the
      // date moved, the draft is still there and the undo can be asked for again
      else setOutcome((kept) => (kept?.kind === 'drafted' ? { ...kept, undoFailed: true } : kept));
    } catch {
      setOutcome((kept) =>
        kept?.kind === 'drafted' ? { ...kept, undoFailed: true } : { kind: 'failed' }
      );
    } finally {
      setChecking(false);
    }
  };

  const inFlight = useRef(false);
  const answer = async (action: PrepFileAction) => {
    // The ref closes the door at once: a key that arrives twice before the file is drawn again
    // must not start a second read and save
    if (inFlight.current || !prepActionOpen(action, state)) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const fresh = await readNow();
      if (!shown.current) return;
      const now = prepCardFields(fresh.card);
      if (action === 'draft') {
        // Only the fields that are empty right now are filled
        const filled = draftOf(fresh);
        // Nothing left to fill (somebody filled it meanwhile): the file now shows why, and what
        // it said about an earlier answer no longer holds
        if (!filled) {
          setOutcome(null);
          return;
        }
        save.mutate(
          // The row's own date, also for a card saved empty (which the file shows as none)
          { ...scope, card: filled, expectedUpdatedAt: fresh.card?.updatedAt ?? null },
          {
            onSuccess: () => {
              setOutcome({ kind: 'drafted', before: now, after: filled });
              setPart('prep');
            },
            onError: (error) => {
              if (error.data?.code === 'CONFLICT') void afterRefusal('draft');
              else setOutcome({ kind: 'failed' });
            },
          }
        );
      } else if (outcome?.kind === 'drafted') {
        // The card no longer says what the draft put there: the file now says so, nothing is sent
        if (!samePrepCard(now, outcome.after)) return;
        save.mutate(
          { ...scope, card: outcome.before, expectedUpdatedAt: fresh.card?.updatedAt ?? null },
          {
            onSuccess: () => setOutcome({ kind: 'undone' }),
            onError: (error) => {
              if (error.data?.code === 'CONFLICT') {
                void afterRefusal('undo');
                return;
              }
              // The draft is still there: keep it in hand, so the undo can be asked for again
              setOutcome((kept) =>
                kept?.kind === 'drafted' ? { ...kept, undoFailed: true } : { kind: 'failed' }
              );
            },
          }
        );
      }
    } catch {
      // The card could not be read again: nothing was sent
      setOutcome((kept) =>
        kept?.kind === 'drafted' ? { ...kept, undoFailed: action === 'undo' } : { kind: 'failed' }
      );
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };
  // After an answer the focus is on the report: Enter pressed once more does nothing
  useEffect(() => {
    if (outcome) reportRef.current?.focus();
  }, [outcome]);

  // The report takes the focus when the file opens: Enter pressed once too often does nothing
  useEffect(() => {
    reportRef.current?.focus();
  }, []);

  // The file's keys: 1 and 2 turn to a part of the file, 3 drafts the card and Z undoes it. Esc
  // is the room's (it closes the file), except while the card is being saved: the request is
  // out, and a file closed now would carry it out without its report or its undo
  const onFileKey: RoomKeys = (event) => {
    if (isImeKey(event)) return false;
    if (event.key === 'Escape') return working;
    const action = prepActionOfKey(event.key);
    if (action) {
      // A key that is closed right now does nothing, and is not anyone else's either
      event.preventDefault();
      void answer(action);
      return true;
    }
    const chosen = prepPartOfKey(event.key);
    if (!chosen) return false;
    event.preventDefault();
    setPart(chosen);
    return true;
  };
  useRoomKeys(keysRef, onFileKey);

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
          {/* While the card is read and saved, what an earlier answer said is not repeated */}
          {working && <p className="text-base leading-relaxed font-medium">{t('checking')}</p>}
          {outcome && !working && (
            <p className="text-base leading-relaxed font-medium">
              {outcome.kind === 'drafted'
                ? stale
                  ? t('changedSince')
                  : outcome.undoFailed
                    ? t('undoFailed')
                    : t('drafted')
                : outcome.kind === 'undone'
                  ? t('undone')
                  : outcome.kind === 'refused'
                    ? outcome.fillable
                      ? t('refused')
                      : t('refusedNothing')
                    : t('failed')}
            </p>
          )}
          {/* Why the draft is closed, to those who could ask for it */}
          {canEdit && !drafted && !fillable && !state.busy && outcome?.kind !== 'refused' && (
            <p className="text-sm leading-relaxed text-[#d8d2c4]">
              {material ? t('nothingToFill') : t('noMaterial')}
            </p>
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
          {/* Only those who may change the card are offered the draft */}
          {canEdit && (
            <li>
              <RoomChoiceButton
                keyCap={PREP_FILE_KEYS.draft}
                closed={!prepActionOpen('draft', state)}
                waiting={state.busy}
                onClick={() => void answer('draft')}
              >
                {t('choices.draft')}
              </RoomChoiceButton>
            </li>
          )}
          {drafted && (
            <li>
              <RoomChoiceButton
                keyCap={PREP_FILE_KEYS.undo}
                closed={!prepActionOpen('undo', state)}
                waiting={state.busy}
                onClick={() => void answer('undo')}
              >
                {t('choices.undo')}
              </RoomChoiceButton>
            </li>
          )}
          <li>
            <RoomChoiceButton
              keyCap="Esc"
              closed={working}
              waiting={working}
              onClick={() => {
                if (!working) onClose();
              }}
            >
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
