'use client';

import { useSidebar } from '@/context/SidebarContext';
import type React from 'react';

const Backdrop: React.FC = () => {
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  if (!isMobileOpen) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: click-outside overlay; the header menu button also closes the sidebar
    <div className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden" onClick={toggleMobileSidebar} />
  );
};

export default Backdrop;
