'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { roleHasWork } from '@/lib/features/ai-employees/types/works';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowDown,
  Box,
  DoorOpen,
  List,
  MessageCircle,
  Moon,
  Palette,
  Plus,
  ScanSearch,
  Sun,
  UserPlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  OFFICE_3D_KEY,
  OFFICE_3D_TRIAL,
  Office3DBoundary,
  Office3DTrialPanel,
} from './office-3d/office-3d-trial';
import type { OfficeEvent } from './office-3d/office-emotion';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import { SceneDrawing } from './office-map';
import {
  AREA_RECTS,
  DESK_SEATS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  areaOf,
  spotOf,
} from './office-map-layout';
import {
  type TalkChoice,
  type TalkLine,
  cameraOffset,
  firstRoleToVisit,
  homeView,
  hourIn,
  isNightHour,
  looksByRole,
  presidentTasks,
  statusByRole,
  talkChoices,
  talkLineKey,
} from './office-president';
import { STATUS_LIGHT, shade } from './office-prims';
import { ROLE_ACCENTS } from './office-robot';
import { OfficeRoomDue } from './office-room-due';
import { OfficeRoomLeads, type RoomKeys } from './office-room-leads';
import { OFFICE_ROOMS, type OfficeRoom, ROOM_KEYS, ROOM_ROLES, roomOfKey } from './office-rooms';
import { SCENE_HEIGHT, SCENE_WIDTH, project } from './office-scene';
import { RobotPortrait } from './office-scene-svg';
import { OfficeStudio } from './office-studio';

type Stage = 'title' | 'world' | 'talk' | 'room' | 'studio';

/**
 * The floor in 3D (#1135, spike): three.js is loaded only when the president switches to it, so
 * the rest of the app does not carry it
 */
const OfficeCanvas3D = dynamic(() => import('./office-3d/office-canvas-3d'), { ssr: false });

/** How far the office can be dragged past the edge of the screen */
const PAN_MARGIN = { x: 320, y: 200 };
/** How far the president can zoom into the office */
/** How much darker than the role's accent the band under an AI employee's name is */
export const NAME_BAND_SHADE = 0.8;
const ZOOM_MAX = 2;
/** One step of the camera, with the button or the + and - keys */
const ZOOM_STEP = 1.25;
/** How close the camera comes in a conversation */
const TALK_ZOOM = 2.1;
/** How close the camera comes in a room: the desk stays in view beside the room's board */
const ROOM_ZOOM = 1.9;

/**
 * The full-screen office (Refs #1109): the user enters the office as the president of the
 * company. Three stages: the title (clock in), the office (the whole screen is the floor, with
 * the staff list, the president's tasks, the map and the actions over it) and a conversation
 * with an AI employee, where the president answers with choices that hire, pause or resume it.
 *
 * Day and night follow the clock here, not the theme. Everything shown comes from the real state
 * of the office; nothing is scored. Esc steps back (conversation, office, title, out); E talks
 * to the chosen AI employee; the number keys answer; + and - move the camera in and out, 0 resets
 * it. Keys held down, or pressed with Ctrl, Alt or the command key, do nothing here.
 *
 * The layer is a Radix dialog: it keeps the focus inside, takes it back when the focused control
 * goes away (the choices change after an answer), and hides the app behind it from assistive
 * technology. Clicking or dragging the floor leaves the focus on the layer, so the keys go on
 * working.
 */
export function OfficeImmersive({
  organizationId,
  companyName,
  presidentName,
  employees,
  canManage,
  onExit,
}: {
  organizationId: string;
  companyName: string | null;
  presidentName: string | null;
  employees: readonly OfficeEmployee[];
  canManage: boolean;
  onExit: () => void;
}) {
  const t = useTranslations('aiOffice.immersive');
  const tOffice = useTranslations('aiOffice');
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'Asia/Tokyo';
  const utils = trpc.useUtils();
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('title');
  const [now, setNow] = useState(() => new Date());
  const [size, setSize] = useState({ w: 1280, h: 800 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  // What the AI employee said to the last answer, and whether the answer was carried out
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The room the president is in (stage 'room'), and what its keys do
  const [room, setRoom] = useState<OfficeRoom>(OFFICE_ROOMS[0]);
  const roomKeys = useRef<RoomKeys | null>(null);
  // Something is open inside the room (a customer file): Esc closes that first
  const [roomFileOpen, setRoomFileOpen] = useState(false);
  // The 3D spike (#1135): whether the floor is drawn in 3D, and what the trial panel pretends
  // (a status and an event for the chosen employee, on this screen only)
  const [threeD, setThreeD] = useState(false);
  const [trialStatus, setTrialStatus] = useState<Partial<Record<AiEmployeeRole, DeskStatus>>>({});
  const [trialEvent, setTrialEvent] = useState<Partial<Record<AiEmployeeRole, OfficeEvent>>>({});
  const [fps, setFps] = useState<number | null>(null);
  // The 2D floor stays until the 3D one drew its first frame, and comes back if it cannot be shown
  const [threeDReady, setThreeDReady] = useState(false);
  const [threeDFailed, setThreeDFailed] = useState(false);
  const leave3d = (failed: boolean) => {
    setThreeD(false);
    setThreeDReady(false);
    setThreeDFailed(failed);
    // What the trial panel pretended ends with the trial
    setTrialStatus({});
    setTrialEvent({});
    setFps(null);
  };
  const toggle3d = () => {
    if (!OFFICE_3D_TRIAL) return;
    if (threeD) leave3d(false);
    else {
      setThreeDFailed(false);
      setThreeD(true);
    }
  };
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setReducedMotion(query?.matches ?? false);
  }, []);

  const statuses = statusByRole(employees);
  const byRole = new Map(employees.map((employee) => [employee.role, employee]));
  const looks = looksByRole(employees);
  const [selected, setSelected] = useState<AiEmployeeRole>(() =>
    firstRoleToVisit(statuses, canManage)
  );
  // Day and night by the same clock the screen shows
  const night = isNightHour(hourIn(now, timeZone));
  const tasks = presidentTasks(statuses, canManage);
  const hired = employees.length;
  const vacant = AI_EMPLOYEE_ROLES.length - hired;

  useEffect(() => {
    setMounted(true);
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearInterval(clock);
    };
  }, []);

  // The stage that just opened takes the focus, and so does what follows an answer: in a
  // conversation the report of the AI employee (never a choice, so that Enter pressed once too
  // often cannot hire or pause), then the one way back once the answer was carried out
  const answered = outcome?.ok === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the stage or the outcome changes
  useEffect(() => {
    if (!mounted) return;
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [mounted, stage, answered]);

  const refresh = () => utils.aiEmployees.office.invalidate({ organizationId });
  // What the chosen AI employee says, in its own tone (#1134)
  const say = (line: TalkLine, values?: Record<string, string>) =>
    t(
      talkLineKey(line, byRole.get(selected)?.profile.tone ?? 'polite') as 'talk.failed',
      values as never
    );
  const hire = trpc.aiEmployees.hire.useMutation({
    onSuccess: async (_data, variables) => {
      setOutcome({ text: t('talk.hired', { name: variables.name }), ok: true });
      await refresh();
    },
    onError: () => setOutcome({ text: t('talk.failed'), ok: false }),
  });
  const update = trpc.aiEmployees.update.useMutation({
    onSuccess: async (updated, variables) => {
      setOutcome({
        text:
          variables.status === 'paused'
            ? say('pausedDone', { name: updated.name })
            : // Until the role has work, going back means going back to training
              say(roleHasWork(selected) ? 'resumed' : 'resumedTraining', {
                name: updated.name,
              }),
        ok: true,
      });
      await refresh();
    },
    onError: () => setOutcome({ text: say('failed'), ok: false }),
  });

  const clockIn = () => {
    setStage('world');
    // The browser may refuse (no user gesture, an embedded page): the overlay still covers the app
    rootRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  const leave = useCallback(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
    onExit();
  }, [onExit]);
  const enterRoom = (next: OfficeRoom) => {
    setRoom(next);
    setStage('room');
  };
  const talkTo = (role: AiEmployeeRole) => {
    setSelected(role);
    setOutcome(null);
    setStage('talk');
  };

  const selectedStatus = statuses[selected];
  const selectedEmployee = byRole.get(selected) ?? null;
  const selectedName = selectedEmployee?.name ?? tOffice(`roles.${selected}.title`);
  // Only someone who manages the AI employees customizes one, and only one that was hired
  const canCustomize = canManage && selectedEmployee !== null;
  // Once an answer was carried out, the only thing left to say is goodbye: the first choice must
  // not turn into the opposite order under the president's finger
  const choices: TalkChoice[] = answered ? ['leave'] : talkChoices(selectedStatus, canManage);
  const busy = hire.isPending || update.isPending;
  const stepBack = () => {
    if (stage === 'talk' || stage === 'room' || stage === 'studio') setStage('world');
    else if (stage === 'world') setStage('title');
    else leave();
  };
  const answer = (choice: TalkChoice) => {
    if (busy) return;
    if (choice === 'leave') {
      setStage('world');
      return;
    }
    if (choice === 'hire') {
      hire.mutate({
        organizationId,
        role: selected,
        name: tOffice(`roles.${selected}.defaultName`),
      });
      return;
    }
    if (!selectedEmployee) return;
    update.mutate({
      organizationId,
      employeeId: selectedEmployee.id,
      status: choice === 'pause' ? 'paused' : 'active',
    });
  };

  // Esc is handled by the dialog (onEscapeKeyDown), Tab by its focus scope
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Leave the browser's and the screen reader's own shortcuts alone, and never repeat an order
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (stage === 'world') {
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        talkTo(selected);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      } else if (OFFICE_3D_TRIAL && event.key.toUpperCase() === OFFICE_3D_KEY) {
        event.preventDefault();
        toggle3d();
      } else if ((event.key === 'c' || event.key === 'C') && canCustomize) {
        event.preventDefault();
        setStage('studio');
      } else {
        const entered = roomOfKey(event.key);
        if (entered) {
          event.preventDefault();
          enterRoom(entered);
        }
      }
      return;
    }
    if (stage === 'room' || stage === 'studio') {
      // Esc reaches the room once, through onEscapeKeyDown: here it would be handled twice
      if (event.key !== 'Escape') roomKeys.current?.(event);
      return;
    }
    if (stage === 'talk' && /^[1-9]$/.test(event.key)) {
      const choice = choices[Number(event.key) - 1];
      if (choice) {
        event.preventDefault();
        answer(choice);
      }
    }
  };

  // The camera: the floor covers the screen; a conversation moves in on the AI employee
  const width = Math.max(size.w, (size.h * SCENE_WIDTH) / SCENE_HEIGHT);
  const height = (width * SCENE_HEIGHT) / SCENE_WIDTH;
  const spot = spotOf(selected, selectedStatus);
  const [spotX, spotY] = project(spot.x, spot.y);
  const home = homeView(size, SCENE_WIDTH / SCENE_HEIGHT);
  const scale =
    stage === 'talk' || stage === 'studio'
      ? TALK_ZOOM
      : stage === 'room'
        ? ROOM_ZOOM
        : stage === 'world'
          ? home.zoom * zoom
          : 1.08;
  // In a room the camera rests on the desk of the room's AI employee, left of the board
  const [roomDeskX, roomDeskY] = project(
    DESK_SEATS[ROOM_ROLES[room]].x,
    DESK_SEATS[ROOM_ROLES[room]].y
  );
  const camera =
    stage === 'room'
      ? cameraOffset({
          width,
          height,
          scale,
          px: roomDeskX / SCENE_WIDTH,
          py: (roomDeskY - 45) / SCENE_HEIGHT,
          targetX: size.w * 0.15,
          targetY: size.h * 0.3,
        })
      : stage === 'talk' || stage === 'studio'
        ? cameraOffset({
            width,
            height,
            scale,
            px: spotX / SCENE_WIDTH,
            py: (spotY - 45) / SCENE_HEIGHT,
            targetX: size.w * 0.32,
            targetY: size.h * 0.42,
          })
        : {
            x: (size.w - width * scale) / 2 + (stage === 'world' ? home.x + pan.x : 0),
            y: (size.h - height * scale) / 2 + (stage === 'world' ? home.y + pan.y : 0),
          };

  // The office can be dragged a little past the edge of the screen, to see what the panels cover
  const clampPan = (x: number, y: number, s: number) => {
    const maxX = Math.max(0, (width * home.zoom * s - size.w) / 2) + PAN_MARGIN.x;
    const maxY = Math.max(0, (height * home.zoom * s - size.h) / 2) + PAN_MARGIN.y;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (stage !== 'world' || (event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setPan(
      clampPan(start.panX + event.clientX - start.x, start.panY + event.clientY - start.y, zoom)
    );
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const zoomBy = (factor: number) => {
    const next = Math.max(home.out, Math.min(ZOOM_MAX, zoom * factor));
    setZoom(next);
    setPan((current) => clampPan(current.x, current.y, next));
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const time = format.dateTime(now, { hour: '2-digit', minute: '2-digit' });
  const show3d = threeD && stage === 'world';
  const floor3d = employees.map((employee) => {
    const status = trialStatus[employee.role] ?? statuses[employee.role];
    return {
      role: employee.role,
      name: employee.name,
      status: status === 'vacant' ? ('idle' as const) : status,
      look: employee.profile.look,
      tone: employee.profile.tone,
    };
  });
  const president = presidentName ?? t('president');

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) leave();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={rootRef}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onEscapeKeyDown={(event) => {
            // Esc steps back one stage; only the title leaves the office. A room may use it
            // first, to close what is open in it
            event.preventDefault();
            const inRoom = { key: 'Escape', preventDefault: () => undefined };
            if ((stage === 'room' || stage === 'studio') && roomKeys.current?.(inRoom)) return;
            stepBack();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
          }}
          // The layer itself holds the focus after a click on the floor: no ring around the screen
          style={{ outline: 'none', boxShadow: 'none' }}
          className="fixed inset-0 z-[100000] overflow-clip bg-[#050915] text-[#f5f1e8]"
        >
          <DialogPrimitive.Title className="sr-only">{t('label')}</DialogPrimitive.Title>
          {/* The world: the whole screen is the office */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onWheel={(event) => {
              if (stage === 'world') zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
            }}
            className={cn(
              'absolute inset-0',
              night
                ? 'bg-[linear-gradient(180deg,#050915_0%,#0d1730_55%,#161d30_100%)]'
                : 'bg-[linear-gradient(180deg,#a9d3fb_0%,#dcecfb_45%,#f3efe8_100%)]',
              stage === 'world' && 'cursor-grab active:cursor-grabbing'
            )}
          >
            <div
              style={{
                width,
                height,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${scale})`,
              }}
              className={cn(
                'absolute top-0 left-0 origin-top-left motion-reduce:transition-none',
                // The floor follows the pointer at once while it is dragged, and glides otherwise
                !dragging && 'transition-transform duration-700 ease-out',
                // The 3D floor takes the place of the drawing in the office
                show3d && threeDReady && 'hidden'
              )}
            >
              <SceneDrawing
                statuses={statuses}
                looks={looks}
                night={stage === 'title' ? true : night}
                labels={stage === 'world'}
              />
              {stage === 'world' &&
                AI_EMPLOYEE_ROLES.map((role) => (
                  <WorldTag
                    key={role}
                    role={role}
                    status={statuses[role]}
                    name={byRole.get(role)?.name ?? null}
                    chosen={role === selected}
                    scale={scale}
                    onChoose={() => setSelected(role)}
                    onTalk={() => talkTo(role)}
                  />
                ))}
            </div>
          </div>
          {show3d && (
            <Office3DBoundary onError={() => leave3d(true)}>
              <OfficeCanvas3D
                employees={floor3d}
                events={trialEvent}
                night={night}
                zoom={zoom}
                focus={selectedEmployee ? selected : null}
                reducedMotion={reducedMotion}
                onFps={setFps}
                onReady={() => setThreeDReady(true)}
              />
            </Office3DBoundary>
          )}
          {/* Seen through a camera */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_46%,rgba(0,0,0,0)_50%,rgba(6,10,20,0.55)_100%)]"
          />

          {stage === 'title' && (
            <div className="absolute inset-0 flex flex-col justify-between bg-[linear-gradient(90deg,rgba(5,9,21,0.96)_0%,rgba(5,9,21,0.8)_34%,rgba(5,9,21,0.15)_66%,rgba(5,9,21,0)_82%)] p-8 sm:p-16">
              <div className="space-y-4">
                <p className="text-sm font-bold tracking-[0.32em] text-[#e9cf9a]">DIAGNOLEADS</p>
                <h2 className="text-6xl leading-none font-bold tracking-wider text-white sm:text-8xl">
                  AI OFFICE
                </h2>
                <p className="font-serif text-2xl font-bold tracking-[0.12em] text-[#e9cf9a] sm:text-3xl">
                  {tOffice('title')}
                </p>
                <p className="max-w-2xl pt-2 font-serif text-lg leading-loose sm:text-xl">
                  {t('title.tagline')}
                </p>
              </div>
              <div className="space-y-6">
                <div className="flex max-w-md flex-col gap-1">
                  <button
                    type="button"
                    data-autofocus
                    onClick={clockIn}
                    className={cn(
                      'flex min-h-14 items-center justify-between gap-4 border-l-[3px] border-white bg-[linear-gradient(90deg,#f3dfb4_0%,#e9cf9a_70%,rgba(233,207,154,0)_100%)] px-5 text-left text-lg font-bold text-[#1b2130] hover:brightness-105',
                      FOCUS
                    )}
                  >
                    {t('title.clockIn')}
                    <span className={cn(KEY, 'border-[#1b2130]/60')}>Enter</span>
                  </button>
                  <button
                    type="button"
                    onClick={leave}
                    className={cn(
                      'flex min-h-14 items-center justify-between gap-4 border-l-[3px] border-transparent px-5 text-left text-lg font-bold text-[#d8d2c4] hover:border-[#e9cf9a]/60 hover:bg-white/10 hover:text-white',
                      FOCUS
                    )}
                  >
                    {t('title.back')}
                    <span className={KEY}>Esc</span>
                  </button>
                </div>
                <p className="text-sm text-[#d8d2c4]">
                  {companyName ? `${companyName}　` : ''}
                  {t('title.staff', { name: president, hired, vacant })}
                </p>
              </div>
            </div>
          )}

          {stage === 'world' && (
            <>
              {/* The president */}
              <div className={cn(PANEL, 'absolute top-5 left-6 w-72 space-y-1 px-4 pt-3 pb-5')}>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center bg-[#e9cf9a] text-sm font-bold text-[#1b2130] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]">
                    {t('president')}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold">{president}</p>
                    {companyName && (
                      <p className="truncate text-sm text-[#d8d2c4]">{companyName}</p>
                    )}
                  </div>
                </div>
                <p className="flex items-center gap-2 pt-1 text-sm text-[#d8d2c4]">
                  {night ? (
                    <Moon className="h-4 w-4 text-[#e9cf9a]" aria-hidden="true" />
                  ) : (
                    <Sun className="h-4 w-4 text-[#e9cf9a]" aria-hidden="true" />
                  )}
                  <span className="font-bold text-[#f5f1e8]">{time}</span>
                  {night ? t('night') : t('day')}
                </p>
              </div>

              {/* The staff, in the order value passes from hand to hand */}
              <div
                className={cn(
                  PANEL,
                  'absolute top-36 left-6 w-72 space-y-2 px-4 pt-3 pb-5 xl:top-auto xl:bottom-6'
                )}
              >
                <h2 className={CAP}>{t('staff')}</h2>
                <p className="text-xs text-[#d8d2c4]">{t('relay')}</p>
                <ul>
                  {AI_EMPLOYEE_ROLES.map((role, index) => {
                    const status = statuses[role];
                    const employee = byRole.get(role);
                    return (
                      <li key={role}>
                        {index > 0 && (
                          <ArrowDown
                            className="mx-auto h-3.5 w-3.5 text-[#e9cf9a]"
                            aria-hidden="true"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setSelected(role)}
                          aria-pressed={role === selected}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-3 border px-2 py-1 text-left hover:bg-white/10',
                            role === selected
                              ? 'border-[#e9cf9a] bg-white/10'
                              : 'border-transparent',
                            FOCUS
                          )}
                        >
                          {status === 'vacant' ? (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-dashed border-[#f5f1e8]/50">
                              <Plus className="h-5 w-5" aria-hidden="true" />
                            </span>
                          ) : (
                            <span
                              aria-hidden="true"
                              style={{ borderColor: ROLE_ACCENTS[role] }}
                              className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden border-2 bg-[#f2f2f2]"
                            >
                              <RobotPortrait
                                role={role}
                                status={status}
                                look={looks[role]}
                                className="h-14 w-10"
                              />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-bold">
                                {employee?.name ?? tOffice(`roles.${role}.title`)}
                              </span>
                              <span
                                style={{ color: status === 'vacant' ? '#d8d2c4' : undefined }}
                                className="shrink-0 text-xs font-bold"
                              >
                                <StatusDot status={status} /> {tOffice(`status.${status}`)}
                              </span>
                            </span>
                            <span className="block truncate text-xs text-[#d8d2c4]">
                              {t(`relaySteps.${role}`)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* What the president has to do */}
              <div
                className={cn(
                  PANEL,
                  'absolute top-5 right-6 hidden w-80 space-y-3 px-4 pt-3 pb-6 lg:block'
                )}
              >
                <h2 className={CAP}>{t('tasks.heading')}</h2>
                {tasks.length === 0 ? (
                  <p className="text-sm leading-relaxed">
                    {t(canManage ? 'tasks.none' : 'tasks.noneReadOnly')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tasks.map((task, index) => (
                      <li key={`${task.kind}-${task.role}`}>
                        <button
                          type="button"
                          onClick={() => talkTo(task.role)}
                          className={cn(
                            'flex min-h-11 w-full items-start gap-3 px-1 py-1 text-left text-sm hover:bg-white/10',
                            FOCUS
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-1.5 h-2.5 w-2.5 shrink-0 rotate-45',
                              index === 0 ? 'bg-[#e9cf9a]' : 'border border-[#f5f1e8]'
                            )}
                          />
                          <span>
                            <span className="block font-bold">
                              {t(`tasks.${task.kind}`, {
                                role: tOffice(`roles.${task.role}.title`),
                              })}
                            </span>
                            <span className="block text-[#d8d2c4]">
                              {t(`tasks.${task.kind}Why`)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* The map of the floor */}
              <FloorMap statuses={statuses} selected={selected} label={t('map')} />

              {/* The 3D spike's trial panel: pretend a status or an event to watch the robot */}
              {OFFICE_3D_TRIAL && threeD && threeDReady && selectedEmployee && (
                <Office3DTrialPanel
                  name={selectedEmployee.name}
                  status={trialStatus[selected] ?? selectedStatus}
                  event={trialEvent[selected]}
                  fps={fps}
                  onStatus={(status) => {
                    setTrialStatus((current) => ({ ...current, [selected]: status }));
                    setTrialEvent((current) => ({ ...current, [selected]: undefined }));
                  }}
                  onEvent={(event) =>
                    setTrialEvent((current) => ({ ...current, [selected]: event }))
                  }
                />
              )}
              {/* While the 3D floor loads the 2D one stays; if it cannot be shown, the office says so */}
              {OFFICE_3D_TRIAL && ((threeD && !threeDReady) || threeDFailed) && (
                <output
                  className={cn(
                    PANEL,
                    'absolute bottom-32 left-1/2 block -translate-x-1/2 px-4 py-3 text-sm'
                  )}
                >
                  {t(threeDFailed ? 'trial3d.failed' : 'trial3d.loading')}
                </output>
              )}

              {/* The floor guide: the rooms that hold work */}
              <nav
                aria-label={t('floorGuide')}
                className="absolute inset-x-0 bottom-32 flex justify-center gap-2 lg:top-5 lg:bottom-auto"
              >
                {OFFICE_ROOMS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => enterRoom(entry)}
                    className={cn(
                      'flex min-h-11 items-center gap-2.5 border border-[#e9cf9a]/55 bg-[rgba(10,14,24,0.86)] px-3.5 text-left text-sm hover:bg-[rgba(36,44,64,0.95)]',
                      FOCUS
                    )}
                  >
                    <span className={KEY}>{ROOM_KEYS[entry]}</span>
                    <span className="font-bold">{tOffice(`rooms.${entry}`)}</span>
                    <span className="text-[#d8d2c4]">{t(`room.work.${entry}`)}</span>
                    <DoorOpen className="h-4 w-4 text-[#e9cf9a]" aria-hidden="true" />
                  </button>
                ))}
              </nav>

              {/* The actions */}
              <div className="absolute inset-x-0 bottom-6 flex flex-col items-center">
                <div className="flex gap-2.5">
                  <HudButton onClick={() => talkTo(selected)} hotkey="E" autoFocus>
                    <MessageCircle className="h-6 w-6" aria-hidden="true" />
                    {t('actions.talk')}
                  </HudButton>
                  {canCustomize && (
                    <HudButton onClick={() => setStage('studio')} hotkey="C">
                      <Palette className="h-6 w-6" aria-hidden="true" />
                      {t('studio.open')}
                    </HudButton>
                  )}
                  <HudButton onClick={() => zoomBy(ZOOM_STEP)} hotkey="+">
                    <ZoomIn className="h-6 w-6" aria-hidden="true" />
                    {t('actions.zoomIn')}
                  </HudButton>
                  <HudButton onClick={() => zoomBy(1 / ZOOM_STEP)} hotkey="-">
                    <ZoomOut className="h-6 w-6" aria-hidden="true" />
                    {t('actions.zoomOut')}
                  </HudButton>
                  {OFFICE_3D_TRIAL && (
                    <HudButton onClick={toggle3d} hotkey={OFFICE_3D_KEY}>
                      <Box className="h-6 w-6" aria-hidden="true" />
                      {t(threeD ? 'trial3d.off' : 'trial3d.on')}
                    </HudButton>
                  )}
                  <HudButton onClick={resetView} hotkey="0">
                    <ScanSearch className="h-6 w-6" aria-hidden="true" />
                    {t('actions.resetView')}
                  </HudButton>
                  <HudButton onClick={leave} hotkey="">
                    <List className="h-6 w-6" aria-hidden="true" />
                    {t('actions.list')}
                  </HudButton>
                  <HudButton onClick={() => setStage('title')} hotkey="Esc">
                    <DoorOpen className="h-6 w-6" aria-hidden="true" />
                    {t('actions.clockOut')}
                  </HudButton>
                </div>
              </div>

              {/* The one in front of the president */}
              <div
                className={cn(
                  PANEL,
                  'absolute right-6 bottom-6 hidden w-80 space-y-3 px-4 pt-3 pb-6 lg:block'
                )}
              >
                <h2 className={CAP}>{t('target')}</h2>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    style={{ borderColor: ROLE_ACCENTS[selected] }}
                    className="flex h-16 w-16 shrink-0 items-end justify-center overflow-hidden border-2 bg-[#f2f2f2]"
                  >
                    <RobotPortrait
                      role={selected}
                      status={selectedStatus}
                      look={looks[selected]}
                      className="h-[5.5rem] w-16"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold">{selectedName}</p>
                    <p className="truncate text-sm text-[#d8d2c4]">
                      {tOffice(`roles.${selected}.title`)}・
                      {tOffice(`rooms.${areaOf(selected, selectedStatus)}`)}
                    </p>
                    <p className="text-sm font-bold">
                      <StatusDot status={selectedStatus} /> {tOffice(`status.${selectedStatus}`)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => talkTo(selected)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-center gap-2 bg-[#e9cf9a] text-sm font-bold text-[#1b2130] hover:bg-[#f3dfb4]',
                    FOCUS
                  )}
                >
                  <span className={cn(KEY, 'border-[#1b2130]/60')}>E</span>
                  {t('actions.talk')}
                </button>
              </div>
            </>
          )}

          {stage === 'studio' && selectedEmployee && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[rgba(6,10,20,0.78)]"
              />
              <div className="absolute top-4 left-6">
                <p className={CAP}>{tOffice(`roles.${selected}.title`)}</p>
                <h2 className="text-xl font-bold">
                  {t('studio.of', { name: selectedEmployee.name })}
                </h2>
              </div>
              <OfficeStudio
                // A fresh studio for each employee: the draft never carries over
                key={selectedEmployee.id}
                organizationId={organizationId}
                employee={selectedEmployee}
                status={selectedStatus}
                keysRef={roomKeys}
                onClose={() => setStage('world')}
              />
            </>
          )}

          {stage === 'room' && (
            <>
              {/* The room darkens towards its board; the desk stays in the light */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(6,10,20,0.15)_0%,rgba(6,10,20,0.45)_30%,rgba(6,10,20,0.82)_100%)]"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(6,10,20,0.85)_0%,rgba(6,10,20,0)_100%)]"
              />
              <div className="absolute top-4 left-6">
                <p className={CAP}>{tOffice(`rooms.${room}`)}</p>
                <h2 className="text-xl font-bold [text-shadow:0_2px_10px_rgba(4,8,18,0.8)]">
                  {t(`room.work.${room}`)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStage('world')}
                className={cn(
                  'absolute top-5 right-6 flex min-h-11 items-center gap-2.5 px-2 text-sm font-bold [text-shadow:0_2px_10px_rgba(4,8,18,0.8)] hover:text-white',
                  FOCUS
                )}
              >
                {/* While a file is open, Esc belongs to the file: the key is not shown here */}
                {!roomFileOpen && <span className={cn(KEY, 'bg-[#0a0e18]/60')}>Esc</span>}
                {t('room.back')}
              </button>
              {room === 'marketing' ? (
                <OfficeRoomLeads
                  organizationId={organizationId}
                  role={ROOM_ROLES[room]}
                  status={statuses[ROOM_ROLES[room]]}
                  employeeName={byRole.get(ROOM_ROLES[room])?.name ?? null}
                  look={looks[ROOM_ROLES[room]]}
                  keysRef={roomKeys}
                  onOpenLead={leave}
                  onFileOpenChange={setRoomFileOpen}
                />
              ) : (
                <OfficeRoomDue
                  organizationId={organizationId}
                  role={ROOM_ROLES[room]}
                  status={statuses[ROOM_ROLES[room]]}
                  employeeName={byRole.get(ROOM_ROLES[room])?.name ?? null}
                  look={looks[ROOM_ROLES[room]]}
                  keysRef={roomKeys}
                  onOpenNormal={leave}
                />
              )}
            </>
          )}

          {stage === 'talk' && (
            <>
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-16 bg-black" />
              <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-black" />
              <p className="absolute top-5 left-8 flex items-center gap-3 text-sm text-[#d8d2c4]">
                <span className={CAP}>{tOffice(`rooms.${areaOf(selected, selectedStatus)}`)}</span>
                {t('talk.with', { name: selectedName })}
              </p>
              <div className="absolute inset-x-4 bottom-20 flex flex-col gap-4 sm:inset-x-16 lg:flex-row lg:items-stretch">
                <div className="relative flex min-h-48 flex-1 flex-col gap-3 border-t-2 border-[#e9cf9a] bg-[linear-gradient(180deg,rgba(16,21,34,0.95)_0%,rgba(10,14,24,0.92)_100%)] px-6 pt-5 pb-6 sm:pl-48">
                  <span
                    aria-hidden="true"
                    style={{ borderColor: ROLE_ACCENTS[selected] }}
                    className="absolute -top-16 left-6 hidden h-56 w-36 items-end justify-center overflow-hidden border-[3px] bg-[#f2f2f2] shadow-[0_18px_36px_rgba(4,8,18,0.5)] sm:flex"
                  >
                    <RobotPortrait
                      role={selected}
                      status={selectedStatus}
                      look={looks[selected]}
                      className="h-52 w-36"
                    />
                  </span>
                  <p className="flex flex-wrap items-center gap-3">
                    <span
                      // The accent a little darker: white text needs 4.5:1 on every role's color
                      style={{ backgroundColor: shade(ROLE_ACCENTS[selected], NAME_BAND_SHADE) }}
                      className="px-3 py-1 text-base font-bold text-white"
                    >
                      {selectedName}
                    </span>
                    <span className="text-sm text-[#d8d2c4]">
                      {tOffice(`roles.${selected}.title`)}
                    </span>
                    <span className="text-sm font-bold">
                      <StatusDot status={selectedStatus} /> {tOffice(`status.${selectedStatus}`)}
                    </span>
                  </p>
                  <p
                    // The report takes the focus when the conversation opens: it is read out, and
                    // Enter does nothing here
                    data-autofocus={answered ? undefined : ''}
                    tabIndex={-1}
                    aria-live="polite"
                    className={cn(
                      'text-lg leading-loose outline-none sm:text-xl',
                      outcome && !outcome.ok && 'font-bold text-[#fca5a5]'
                    )}
                  >
                    {outcome && !outcome.ok && (
                      <AlertTriangle
                        className="mr-2 inline h-5 w-5 align-[-3px]"
                        aria-hidden="true"
                      />
                    )}
                    {outcome?.text ??
                      `${
                        selectedStatus === 'vacant'
                          ? t('talk.lines.vacant', {
                              role: tOffice(`roles.${selected}.title`),
                              work: tOffice(`roles.${selected}.description`),
                            })
                          : say(selectedStatus, { work: tOffice(`roles.${selected}.description`) })
                      }${
                        // Before hiring: say that a role without work yet starts in training
                        selectedStatus === 'vacant' && !roleHasWork(selected)
                          ? t('talk.trainingFirst')
                          : ''
                      }`}
                  </p>
                  {!canManage && (
                    <p className="text-sm text-[#d8d2c4]">{tOffice('sheet.readOnly')}</p>
                  )}
                </div>
                {/* On a panel of its own: by day the floor behind the choices is bright */}
                <div className="flex w-full shrink-0 flex-col gap-2 border-t-2 border-[#e9cf9a] bg-[rgba(10,14,24,0.92)] p-3 lg:w-80">
                  <h2 className={CAP}>{t('talk.you')}</h2>
                  {choices.map((choice, index) => (
                    <button
                      // By position: the button under the focus stays when the choices change
                      // biome-ignore lint/suspicious/noArrayIndexKey: the choices are a short fixed list
                      key={index}
                      type="button"
                      data-autofocus={answered && index === 0 ? '' : undefined}
                      // Not disabled: a disabled button would drop the focus out of the conversation
                      aria-disabled={busy}
                      onClick={() => answer(choice)}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 border px-4 text-left text-base font-bold aria-disabled:opacity-60',
                        index === 0
                          ? 'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130] hover:bg-[#f3dfb4]'
                          : 'border-[#f5f1e8]/45 bg-[#101726] hover:border-[#e9cf9a] hover:bg-[#1c2540]',
                        FOCUS
                      )}
                    >
                      <span className={cn(KEY, index === 0 && 'border-[#1b2130]/60')}>
                        {index + 1}
                      </span>
                      {choice === 'hire' && <UserPlus className="h-5 w-5" aria-hidden="true" />}
                      {answered ? t('talk.choices.back') : t(`talk.choices.${choice}`)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The coloured light of a status, next to its words */
function StatusDot({ status }: { status: DeskStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: STATUS_LIGHT[status] }}
      className="mr-0.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
    />
  );
}

/** A square action of the bar at the bottom, with its key */
function HudButton({
  onClick,
  hotkey,
  autoFocus = false,
  children,
}: {
  onClick: () => void;
  hotkey: string;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-autofocus={autoFocus ? '' : undefined}
      className={cn(
        // The cut corners are drawn on a layer behind the button: clipping the button itself would
        // clip its focus ring too
        'relative isolate flex h-[5.25rem] w-[5.25rem] flex-col items-center justify-center gap-1.5 text-xs text-[#f5f1e8] before:absolute before:inset-0 before:-z-10 before:border before:border-[#e9cf9a]/55 before:bg-[rgba(10,14,24,0.86)] before:[clip-path:polygon(10px_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%,0_10px)] hover:before:bg-[rgba(36,44,64,0.95)]',
        FOCUS
      )}
    >
      {children}
      {hotkey && (
        <span className={cn(KEY, 'absolute top-1 right-1 bg-[#0a0e18]/60')}>{hotkey}</span>
      )}
    </button>
  );
}

/** The name over an AI employee in the office: choose it, or talk to the chosen one */
function WorldTag({
  role,
  status,
  name,
  chosen,
  scale,
  onChoose,
  onTalk,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  name: string | null;
  chosen: boolean;
  /** The scale of the stage: the tag undoes it, so its text and its target keep their size */
  scale: number;
  onChoose: () => void;
  onTalk: () => void;
}) {
  const tOffice = useTranslations('aiOffice');
  const spot = spotOf(role, status);
  const [x, y] = project(spot.x, spot.y);
  return (
    <button
      type="button"
      onClick={chosen ? onTalk : onChoose}
      aria-current={chosen ? 'true' : undefined}
      style={{
        left: `${(x / SCENE_WIDTH) * 100}%`,
        top: `${((y + 10) / SCENE_HEIGHT) * 100}%`,
        transform: `translate(-50%, 0) scale(${1 / scale})`,
        transformOrigin: 'top center',
      }}
      className={cn(
        'absolute inline-flex min-h-11 items-center gap-2 rounded border bg-[rgba(10,14,24,0.86)] px-3 py-1 text-sm font-bold whitespace-nowrap text-[#f5f1e8] hover:bg-[rgba(36,44,64,0.95)]',
        chosen ? 'border-2 border-[#e9cf9a]' : 'border-[#f5f1e8]/40',
        FOCUS
      )}
    >
      <StatusDot status={status} />
      {name ?? tOffice(`roles.${role}.title`)}{' '}
      <span className="font-normal text-[#d8d2c4]">{tOffice(`status.${status}`)}</span>
      <span className="sr-only">
        {' '}
        {tOffice(`roles.${role}.title`)}・{tOffice(`rooms.${areaOf(role, status)}`)}
      </span>
    </button>
  );
}

/** The floor seen from above, with a light where each AI employee is */
function FloorMap({
  statuses,
  selected,
  label,
}: {
  statuses: Record<AiEmployeeRole, DeskStatus>;
  selected: AiEmployeeRole;
  label: string;
}) {
  const unit = 8;
  return (
    <div className="absolute top-36 left-6 hidden h-28 w-28 overflow-hidden rounded-full border-2 border-[#e9cf9a] bg-[#101726] shadow-[0_14px_30px_rgba(4,8,18,0.5)] xl:block">
      <svg
        viewBox={`-28 -46 ${FLOOR_WIDTH * unit + 56} ${FLOOR_DEPTH * unit + 92}`}
        role="img"
        aria-label={label}
        className="h-full w-full"
      >
        <g transform={`rotate(30 ${(FLOOR_WIDTH * unit) / 2} ${(FLOOR_DEPTH * unit) / 2})`}>
          {Object.entries(AREA_RECTS).map(([area, r], index) => (
            <rect
              key={area}
              x={r.x * unit}
              y={r.y * unit}
              width={r.w * unit}
              height={r.h * unit}
              fill={index % 2 === 0 ? '#3a4257' : '#2f3a4c'}
              stroke="#e9cf9a"
              strokeOpacity={0.5}
            />
          ))}
          {AI_EMPLOYEE_ROLES.filter((role) => statuses[role] !== 'vacant').map((role) => {
            const spot = spotOf(role, statuses[role]);
            return (
              <circle
                key={role}
                cx={spot.x * unit}
                cy={spot.y * unit}
                r={role === selected ? 7 : 5}
                fill={STATUS_LIGHT[statuses[role]]}
                stroke="#ffffff"
                strokeWidth={role === selected ? 2.5 : 1.5}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
