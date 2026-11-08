'use client';
import { Logo, LogoMark } from '@/components/common/Logo';
import { useSidebar } from '@/context/SidebarContext';
import {
  RiBarChartLine,
  RiBriefcase4Line,
  RiCalendarTodoLine,
  RiDashboardLine,
  RiLineChartLine,
  RiSettings4Line,
  RiUserLine,
  RiUserSearchLine,
} from '@remixicon/react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SidebarWidget from './SidebarWidget';

type NavItem = {
  name: string;
  nameKey: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; nameKey: string; path: string }[];
};

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('navigation');

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: 'main' | 'settings';
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>({});
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Locale-aware nav items
  const navItems: NavItem[] = useMemo(
    () => [
      {
        icon: <RiDashboardLine className="w-5 h-5" />,
        name: t('dashboard'),
        nameKey: 'dashboard',
        path: `/${locale}/dashboard`,
      },
      {
        icon: <RiCalendarTodoLine className="w-5 h-5" />,
        name: t('today'),
        nameKey: 'today',
        path: `/${locale}/today`,
      },
      {
        icon: <RiUserLine className="w-5 h-5" />,
        name: t('leads'),
        nameKey: 'leads',
        path: `/${locale}/leads`,
      },
      {
        icon: <RiBriefcase4Line className="w-5 h-5" />,
        name: t('deals'),
        nameKey: 'deals',
        path: `/${locale}/deals`,
      },
      {
        icon: <RiLineChartLine className="w-5 h-5" />,
        name: t('forecast'),
        nameKey: 'forecast',
        path: `/${locale}/forecast`,
      },
      {
        icon: <RiUserSearchLine className="w-5 h-5" />,
        name: t('prospects'),
        nameKey: 'prospects',
        path: `/${locale}/prospects`,
      },
      {
        icon: <RiBarChartLine className="w-5 h-5" />,
        name: t('analytics'),
        nameKey: 'analytics',
        path: `/${locale}/analytics`,
      },
    ],
    [locale, t]
  );

  const settingsItems: NavItem[] = useMemo(
    () => [
      {
        icon: <RiSettings4Line className="w-5 h-5" />,
        name: t('settings'),
        nameKey: 'settings',
        subItems: [
          {
            name: t('organization'),
            nameKey: 'organization',
            path: `/${locale}/settings/organization`,
          },
          { name: t('members'), nameKey: 'members', path: `/${locale}/settings/members` },
          { name: t('webhooks'), nameKey: 'webhooks', path: `/${locale}/settings/webhooks` },
          { name: t('embed'), nameKey: 'embed', path: `/${locale}/settings/embed` },
          {
            name: t('qrCampaigns'),
            nameKey: 'qrCampaigns',
            path: `/${locale}/settings/qr-campaigns`,
          },
          {
            name: t('axPlaybook'),
            nameKey: 'axPlaybook',
            path: `/${locale}/settings/ax-playbook`,
          },
          {
            name: t('agencyLinks'),
            nameKey: 'agencyLinks',
            path: `/${locale}/settings/agency-links`,
          },
        ],
      },
    ],
    [locale, t]
  );

  const isActive = useCallback(
    (path: string) => pathname === path || pathname?.startsWith(`${path}/`),
    [pathname]
  );

  const ChevronDownIcon = () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  const HorizontalDots = () => (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  );

  const renderMenuItems = (items: NavItem[], menuType: 'main' | 'settings') => (
    <ul className="flex flex-col gap-2">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              type="button"
              aria-expanded={openSubmenu?.type === menuType && openSubmenu?.index === index}
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? 'menu-item-active'
                  : 'menu-item-inactive'
              } cursor-pointer ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}
            >
              <span
                className={`${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? 'menu-item-icon-active'
                    : 'menu-item-icon-inactive'
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <span
                  className={`ml-auto transition-transform duration-200 ${
                    openSubmenu?.type === menuType && openSubmenu?.index === index
                      ? 'rotate-180 text-brand-500'
                      : ''
                  }`}
                >
                  <ChevronDownIcon />
                </span>
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                aria-current={isActive(nav.path) ? 'page' : undefined}
                className={`menu-item group ${isActive(nav.path) ? 'menu-item-active' : 'menu-item-inactive'}`}
              >
                <span
                  className={`${isActive(nav.path) ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : '0px',
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      aria-current={isActive(subItem.path) ? 'page' : undefined}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? 'menu-dropdown-item-active'
                          : 'menu-dropdown-item-inactive'
                      }`}
                    >
                      {subItem.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  useEffect(() => {
    let submenuMatched = false;
    for (const menuType of ['main', 'settings'] as const) {
      const items = menuType === 'main' ? navItems : settingsItems;
      for (const [index, nav] of items.entries()) {
        for (const subItem of nav.subItems ?? []) {
          if (isActive(subItem.path)) {
            setOpenSubmenu({ type: menuType, index });
            submenuMatched = true;
          }
        }
      }
    }

    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [isActive, navItems, settingsItems]);

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: 'main' | 'settings') => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (prevOpenSubmenu && prevOpenSubmenu.type === menuType && prevOpenSubmenu.index === index) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200
        ${isExpanded || isMobileOpen ? 'w-[290px]' : isHovered ? 'w-[290px]' : 'w-[90px]'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* On phones the header already shows the logo above the open menu */}
      <div
        className={`py-6 hidden lg:flex ${!isExpanded && !isHovered ? 'lg:justify-center' : 'justify-start'}`}
      >
        {isExpanded || isHovered || isMobileOpen ? <Logo size="md" /> : <LogoMark size="md" />}
      </div>
      <div className="flex flex-col overflow-y-auto pt-6 lg:pt-0 duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered ? 'lg:justify-center' : 'justify-start'
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? t('menu') : <HorizontalDots />}
              </h2>
              {renderMenuItems(navItems, 'main')}
            </div>

            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered ? 'lg:justify-center' : 'justify-start'
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? t('management') : <HorizontalDots />}
              </h2>
              {renderMenuItems(settingsItems, 'settings')}
            </div>
          </div>
        </nav>
        {isExpanded || isHovered || isMobileOpen ? <SidebarWidget /> : null}
      </div>
    </aside>
  );
};

export default AppSidebar;
