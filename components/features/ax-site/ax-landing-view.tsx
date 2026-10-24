'use client';

import { cn } from '@/lib/utils';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AX_SECTIONS } from './site-config';

interface AxLandingViewValue {
  /** Only the diagnosis result is shown: the other sections of the page are not rendered */
  resultOnly: boolean;
  /** The respondent went back to the page from the result (e.g. with a header link) */
  landingRequested: boolean;
  /** The embedded diagnosis tells when its result is shown and when it is left */
  setResultShown: (shown: boolean) => void;
  /**
   * The embedded diagnosis registers how it starts on a migration path (null when it leaves),
   * so a section of the page can start it there (#311)
   */
  registerPathStarter: (starter: PathStarter | null) => void;
  /** Start the embedded diagnosis on a path; false when nothing handled it (e.g. no diagnosis) */
  startOnPath: (platform: string) => boolean;
}

/** Starts the diagnosis on a path; false when it does not (e.g. its result is shown) */
export type PathStarter = (platform: string) => boolean;

const AxLandingViewContext = createContext<AxLandingViewValue | null>(null);

/** The landing page around an embedded diagnosis; null elsewhere (e.g. /ax-diagnosis) */
export function useAxLandingView(): AxLandingViewValue | null {
  return useContext(AxLandingViewContext);
}

/** The anchor the page frame (#top) carries: the logo link goes back to the page */
const TOP_ID = 'top';

/**
 * Section a link of this page points at while it is not rendered (result only), or null.
 * The logo (#top) also brings the page back.
 */
function hiddenTarget(link: HTMLAnchorElement): string | null {
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) {
    return null;
  }
  const id = decodeURIComponent(url.hash.slice(1));
  if (!id) return null;
  return id === TOP_ID || !document.getElementById(id) ? id : null;
}

/** Instant: the page is swapped, there is nothing to follow with a smooth scroll */
function scrollToSection(id: string): void {
  if (id === TOP_ID) window.scrollTo({ top: 0, behavior: 'auto' });
  else document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

/**
 * Landing page with the diagnosis embedded. Once the result is shown, it replaces the page:
 * the other sections are left out and the result starts at the top, as on /ax-diagnosis.
 * Starting again, or a link to a section that is left out, brings the page back.
 */
export function AxLandingView({ children }: { children: ReactNode }) {
  const [resultShown, setResultShownState] = useState(false);
  const [landingRequested, setLandingRequested] = useState(false);
  /** Section to scroll to once the page is shown again (the diagnosis when starting again) */
  const pendingTarget = useRef<string | null>(null);
  const wasResultOnly = useRef(false);
  const resultOnly = resultShown && !landingRequested;

  const setResultShown = useCallback((shown: boolean) => {
    setResultShownState(shown);
    // A new result replaces the page again; starting again shows the page anyway
    setLandingRequested(false);
  }, []);

  // Before paint, so the result never shows up in the middle of the page first
  useLayoutEffect(() => {
    if (resultOnly === wasResultOnly.current) return;
    wasResultOnly.current = resultOnly;
    if (resultOnly) {
      scrollToSection(TOP_ID);
      return;
    }
    scrollToSection(pendingTarget.current ?? AX_SECTIONS.diagnosis);
    pendingTarget.current = null;
  }, [resultOnly]);

  // Links (the header lives outside this view) to a section that is left out bring the page
  // back first, then go to the section
  useEffect(() => {
    if (!resultOnly) return;
    const showSection = (id: string) => {
      pendingTarget.current = id;
      setLandingRequested(true);
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const id = hiddenTarget(link);
      if (!id) return;
      event.preventDefault();
      // The address names the section, as the link itself would have done
      window.history.replaceState(window.history.state, '', `#${encodeURIComponent(id)}`);
      showSection(id);
    };
    // Other ways to such an address (e.g. the browser's back button to an earlier #faq)
    const onHashChange = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && (id === TOP_ID || !document.getElementById(id))) showSection(id);
    };
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [resultOnly]);

  /** Kept in a ref: registering does not render the page again */
  const pathStarter = useRef<PathStarter | null>(null);
  const registerPathStarter = useCallback((starter: PathStarter | null) => {
    pathStarter.current = starter;
  }, []);
  const startOnPath = useCallback(
    (platform: string) => pathStarter.current?.(platform) ?? false,
    []
  );

  const value = useMemo(
    () => ({ resultOnly, landingRequested, setResultShown, registerPathStarter, startOnPath }),
    [resultOnly, landingRequested, setResultShown, registerPathStarter, startOnPath]
  );
  return <AxLandingViewContext.Provider value={value}>{children}</AxLandingViewContext.Provider>;
}

/**
 * Sections of the landing page other than the diagnosis: not rendered while only the result is
 * shown, so they are neither seen nor read aloud
 */
export function AxLandingOnly({ children }: { children: ReactNode }) {
  const view = useAxLandingView();
  return view?.resultOnly ? null : children;
}

interface AxDiagnosisFrameProps {
  /** Eyebrow, heading and lead of the section (left out while only the result is shown) */
  intro: ReactNode;
  children: ReactNode;
}

/**
 * Diagnosis section of the landing page. While only the result is shown it takes the layout
 * of /ax-diagnosis; the diagnosis stays at the same place in the tree, so it keeps its state.
 */
export function AxDiagnosisFrame({ intro, children }: AxDiagnosisFrameProps) {
  const resultOnly = useAxLandingView()?.resultOnly ?? false;
  return (
    <section
      id={AX_SECTIONS.diagnosis}
      aria-labelledby={resultOnly ? undefined : 'ax-diagnosis-heading'}
      className={cn(
        'bg-gradient-to-b from-white to-ax-mist',
        // Little room above the intro: a jump here should show the first question too (#420)
        resultOnly ? 'py-10 sm:py-14' : 'pb-16 pt-10 sm:pb-24 sm:pt-12'
      )}
    >
      <div className={cn('mx-auto px-4', resultOnly ? 'max-w-3xl' : 'max-w-4xl sm:px-6')}>
        {resultOnly ? null : intro}
        <div
          className={cn(
            'rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10',
            !resultOnly && 'mt-10'
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
