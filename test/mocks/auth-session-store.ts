/**
 * For tests that run the real auth client (lib/auth/client.ts) against a stubbed network: keeps
 * better-auth's session store running for the whole file and stops it before jsdom goes (#706).
 * Call it once at the top level of the file:
 *
 *   keepAuthSessionStoreMounted(authClient.$store.atoms.session);
 *
 * The store runs while it has a listener. nanostores stops it 1 s after the last one goes, and
 * stopping removes better-auth's listeners from `window`. Kept running, like an open tab, that
 * timer never runs after jsdom is gone (a worker on a busy machine can outlive jsdom by more than
 * 1 s). afterAll stops it on a fake clock and runs the timer at once. Tests that mock
 * '@/lib/auth/client' do not need this.
 */
import { afterAll, beforeAll, expect, vi } from 'vitest';

/** The part of a nanostores store this uses (nanostores is not a direct dependency) */
type Listenable = { listen: (listener: () => void) => () => void };

export function keepAuthSessionStoreMounted(store: Listenable) {
  let stopListening = () => {};

  beforeAll(() => {
    stopListening = store.listen(() => {});
  });

  afterAll(() => {
    let stopTimers = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stopListening();
      stopTimers = vi.getTimerCount();
      // nanostores' 1 s stop timer, run now: better-auth removes its listeners while `window` exists
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
    // No timer means something still listens (a test left a listener or a rendered page), and the
    // store would stop later on the real clock, possibly after jsdom is gone
    expect(stopTimers, 'nanostores timers queued when the last listener went').toBe(1);
  });
}
