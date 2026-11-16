/** The frame-rate meter of the 3D floor, kept out of the office's state (#1270) */
import { createFpsMeter } from '@/components/features/ai-employees/office-3d/office-fps';
import { describe, expect, it, vi } from 'vitest';

describe('createFpsMeter', () => {
  it('tells its listeners of a new figure only, and forgets it on reset', () => {
    const meter = createFpsMeter();
    const listener = vi.fn();
    const stop = meter.subscribe(listener);
    expect(meter.get()).toBeNull();

    meter.report(42);
    meter.report(42);
    expect(meter.get()).toBe(42);
    expect(listener).toHaveBeenCalledTimes(1);

    meter.reset();
    expect(meter.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    meter.report(30);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
