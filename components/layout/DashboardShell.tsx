'use client';

import { AdminSessionGuard } from '@/components/auth/AdminSessionGuard';
import AppHeader from '@/components/layout/AppHeader';
import AppSidebar from '@/components/layout/AppSidebar';
import Backdrop from '@/components/layout/Backdrop';
import { SidebarProvider } from '@/context/SidebarContext';
import { useSidebar } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { shareCspNonceWithScrollLock } from '@/lib/csp/document-nonce';

// Once per page, before any dialog or select opens: Radix's scroll lock adds a <style> element,
// which the CSP allows only with the page's nonce (#317)
shareCspNonceWithScrollLock();

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  return (
    // dl-admin: the DADS colors and focus of the admin site (app/globals.css, #548)
    <div className="dl-admin min-h-screen xl:flex bg-gray-50 dark:bg-gray-900">
      <AppSidebar />
      <Backdrop />
      <div
        className={`min-w-0 flex-1 transition-all duration-300 ease-in-out ${
          isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]'
        }`}
      >
        <AppHeader />
        <main className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <AdminSessionGuard>
          <DashboardLayoutContent>{children}</DashboardLayoutContent>
        </AdminSessionGuard>
      </SidebarProvider>
    </ThemeProvider>
  );
}
