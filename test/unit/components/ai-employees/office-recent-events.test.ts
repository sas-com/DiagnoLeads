/**
 * What really just happened to an AI employee (#1148): shown for a short while, counted from the
 * moment the employee stands still.
 */
import {
  EVENT_SHOWN_MS,
  useRecentEvents,
} from '@/components/features/ai-employees/office-recent-events';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Walking = Partial<Record<AiEmployeeRole, boolean>>;

describe('useRecentEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (walking: Walking = {}) =>
    renderHook(({ walking }: { walking: Walking }) => useRecentEvents(walking), {
      initialProps: { walking },
    });

  it('has nothing to show until something happened', () => {
    const { result } = start();
    expect(result.current[0]).toEqual({});
  });

  it('shows an event for a while, then lets the status speak again', () => {
    const { result } = start();
    act(() => result.current[1]('sales', 'hired'));
    expect(result.current[0]).toEqual({ sales: 'hired' });
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS - 1);
    });
    expect(result.current[0]).toEqual({ sales: 'hired' });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toEqual({});
  });

  it('counts the while of each employee by itself', () => {
    const { result } = start();
    act(() => result.current[1]('sales', 'hired'));
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS / 2);
    });
    act(() => result.current[1]('marketer', 'resumed'));
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS / 2);
    });
    expect(result.current[0]).toEqual({ marketer: 'resumed' });
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS / 2);
    });
    expect(result.current[0]).toEqual({});
  });

  it('starts the while over for a new event of the same employee', () => {
    const { result } = start();
    act(() => result.current[1]('sales', 'hired'));
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS - 10);
    });
    act(() => result.current[1]('sales', 'resumed'));
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS - 10);
    });
    expect(result.current[0]).toEqual({ sales: 'resumed' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current[0]).toEqual({});
  });

  it('keeps the event while the employee is on its way, and counts from its arrival', () => {
    const { result, rerender } = start();
    act(() => result.current[1]('sales', 'resumed'));
    // The status arrives and the robot sets off, a moment after the order
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ walking: { sales: true } });
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS * 3);
    });
    expect(result.current[0]).toEqual({ sales: 'resumed' });
    // It arrives: the whole while is still ahead
    rerender({ walking: { sales: false } });
    act(() => {
      vi.advanceTimersByTime(EVENT_SHOWN_MS - 1);
    });
    expect(result.current[0]).toEqual({ sales: 'resumed' });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toEqual({});
  });

  it('leaves no timer behind when the office goes away', () => {
    const { result, unmount } = start();
    act(() => result.current[1]('sales', 'hired'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
