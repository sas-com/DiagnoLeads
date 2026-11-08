'use client';

import type React from 'react';
import { createContext, useContext, useLayoutEffect, useState } from 'react';

type Theme = 'light' | 'dark';

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Where the theme the user picked with the toggle is kept (nothing stored = follow the OS) */
export const THEME_STORAGE_KEY = 'diagnoleads-theme';
/**
 * The old key. It was written on every visit (always "light" unless toggled), so only a
 * stored "dark" is known to be the user's own choice.
 */
const LEGACY_THEME_STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The theme to start with: the user's choice from the toggle, else the OS setting.
 */
export function resolveInitialTheme(
  stored: string | null,
  legacyStored: string | null,
  prefersDark: boolean
): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  if (legacyStored === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');
  const [isInitialized, setIsInitialized] = useState(false);

  // Layout effects, not passive ones: when sign-in hands over to the dashboard, the old provider's
  // cleanup and the new one's setup both run before the browser paints, so the page does not
  // flash light between them (#987). They do not run on the server.
  useLayoutEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    const stored = readStorage(THEME_STORAGE_KEY);
    setTheme(
      resolveInitialTheme(stored, readStorage(LEGACY_THEME_STORAGE_KEY), media?.matches ?? false)
    );
    setIsInitialized(true);

    // Without a choice of their own, follow the OS when it switches (e.g. at sunset)
    if (!media || stored) return;
    const onChange = (event: MediaQueryListEvent) => {
      if (!readStorage(THEME_STORAGE_KEY)) setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    if (isInitialized) {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [theme, isInitialized]);

  // The class sits on <html>, outside this tree: take it off when the admin or sign-in screens go,
  // so a public page reached by client-side navigation (e.g. Back from sign-in) is not dark (#987)
  useLayoutEffect(() => () => document.documentElement.classList.remove('dark'), []);

  const toggleTheme = () => {
    setTheme((prevTheme) => {
      const next = prevTheme === 'light' ? 'dark' : 'light';
      // Only an explicit choice is stored; until then the OS setting decides
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
        localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      } catch {
        // Storage blocked: the choice lasts for this page only
      }
      return next;
    });
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
