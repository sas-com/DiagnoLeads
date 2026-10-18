/**
 * ThemeToggleButton Component Tests
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as renderRaw, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import messages from '@/locales/ja/common.json';
import { ThemeToggleButton } from '@/components/common/ThemeToggleButton';

// The button reads its label from the real Japanese messages
const render = (ui: ReactElement) =>
  renderRaw(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {ui}
    </NextIntlClientProvider>
  );

// Mock the ThemeContext
vi.mock('@/context/ThemeContext', () => ({
  useTheme: vi.fn(),
}));

import { useTheme } from '@/context/ThemeContext';

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should render toggle button', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should have correct aria-label for light mode', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'ダークモードに切り替え');
  });

  it('should have correct aria-label for dark mode', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'ライトモードに切り替え');
  });

  it('should call toggleTheme on click', () => {
    const toggleTheme = vi.fn();
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme,
    });
    
    render(<ThemeToggleButton />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('should render sun icon in dark mode', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('should render moon icon in light mode', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('should have correct button styles', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn(),
    });
    
    render(<ThemeToggleButton />);
    const button = screen.getByRole('button');
    // 44px on phones, 40px from lg (#196)
    expect(button).toHaveClass('w-11', 'h-11', 'lg:w-10', 'lg:h-10');
    expect(button).toHaveClass('rounded-lg');
  });
});
