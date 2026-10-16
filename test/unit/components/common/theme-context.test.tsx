/**
 * Theme: follows the OS until the user picks one with the toggle — Refs #163
 */
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  resolveInitialTheme,
  useTheme,
} from '@/context/ThemeContext';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveInitialTheme', () => {
  it('uses the OS setting when nothing was chosen', () => {
    expect(resolveInitialTheme(null, null, true)).toBe('dark');
    expect(resolveInitialTheme(null, null, false)).toBe('light');
  });

  it('keeps the choice made with the toggle', () => {
    expect(resolveInitialTheme('light', null, true)).toBe('light');
    expect(resolveInitialTheme('dark', null, false)).toBe('dark');
  });

  it('ignores the old auto-saved "light" but keeps an old "dark"', () => {
    expect(resolveInitialTheme(null, 'light', true)).toBe('dark');
    expect(resolveInitialTheme(null, 'dark', false)).toBe('dark');
  });
});

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

describe('ThemeProvider', () => {
  let listeners: ((event: MediaQueryListEvent) => void)[] = [];
  const mockOs = (dark: boolean) => {
    listeners = [];
    window.matchMedia = vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    });
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => document.documentElement.classList.remove('dark'));

  it('starts dark on a dark OS and stores nothing until the user toggles', () => {
    mockOs(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    // The OS switches back: followed, since the user did not choose
    act(() => listeners[0]({ matches: false } as MediaQueryListEvent));
    expect(screen.getByRole('button')).toHaveTextContent('light');

    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
