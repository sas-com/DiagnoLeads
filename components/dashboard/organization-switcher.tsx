'use client';

import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/use-organization';
import type { Organization } from '@/lib/db/schema';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

type OrganizationOption = Organization & { role: string };

const ROLE_KEYS = ['owner', 'admin', 'member'] as const;
type RoleKey = (typeof ROLE_KEYS)[number];
const isRoleKey = (role: string): role is RoleKey =>
  (ROLE_KEYS as readonly string[]).includes(role);

/**
 * Organization Switcher Component
 *
 * Displays the current organization and allows switching between organizations.
 * Selects the first organization automatically when none (or an unknown one) is selected,
 * so a member never lands on empty pages just because nothing was picked yet.
 */
export function OrganizationSwitcher() {
  const t = useTranslations('organizations.switcher');
  const locale = useLocale();
  const router = useRouter();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const { organizationId, organization, setOrganization, isLoading } = useOrganization();
  const utils = trpc.useUtils();

  // Fetch user's organizations
  const { data: orgsData, isLoading: orgsLoading } = trpc.organizations.list.useQuery(
    {},
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  const organizations = (orgsData?.organizations ?? []) as unknown as OrganizationOption[];
  const currentOrg = organizations.find((o) => o.id === organizationId) ?? organization;

  // The stored selection may be missing or belong to another account on this browser
  useEffect(() => {
    if (isLoading || orgsLoading || organizations.length === 0) return;
    if (!organizations.some((o) => o.id === organizationId)) {
      setOrganization(organizations[0].id, organizations[0]);
    }
  }, [isLoading, orgsLoading, organizations, organizationId, setOrganization]);

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const goToCreate = () => {
    closeMenu();
    router.push(`/${locale}/organizations/new`);
  };

  const handleSelectOrganization = async (orgId: string) => {
    const selected = organizations.find((o) => o.id === orgId);
    if (!selected) return;

    setOrganization(orgId, selected);
    closeMenu();

    // Clear all tRPC cache when switching organizations
    // This prevents data from previous organization from showing
    await utils.invalidate();
    router.push(`/${locale}/dashboard`);
  };

  if (isLoading || orgsLoading) {
    return <div className="w-[200px] h-10 bg-gray-200 animate-pulse rounded-md" />;
  }

  if (organizations.length === 0) {
    return (
      <Button variant="outline" onClick={goToCreate} className="w-[200px] justify-start">
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('create')}
      </Button>
    );
  }

  return (
    <div className="relative">
      <details ref={menuRef} className="group">
        <summary
          data-testid="organization-switcher"
          aria-label={t('label')}
          className="flex items-center justify-between w-[200px] min-h-11 lg:min-h-0 px-3 py-2 text-sm border rounded-md hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 cursor-pointer list-none"
        >
          <div className="flex-1 truncate" data-testid="current-org-name">
            {currentOrg?.name || t('select')}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" aria-hidden="true" />
        </summary>

        <div className="absolute z-50 mt-1 w-[200px] bg-white border rounded-md shadow-lg group-open:block hidden dark:bg-gray-900 dark:border-gray-700">
          <div className="p-1" data-testid="org-list">
            {organizations.map((org) => (
              <button
                key={org.id}
                type="button"
                data-testid={`org-item-${org.id}`}
                onClick={() => handleSelectOrganization(org.id)}
                className={cn(
                  'flex items-center w-full px-2 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
                  org.id === organizationId && 'bg-gray-50 dark:bg-gray-800'
                )}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    org.id === organizationId ? 'opacity-100' : 'opacity-0'
                  )}
                  aria-hidden="true"
                />
                <div className="flex-1 text-left">
                  <div className="truncate">{org.name}</div>
                  <div className="text-xs text-gray-500">
                    {isRoleKey(org.role) ? t(`roles.${org.role}`) : org.role}
                  </div>
                </div>
              </button>
            ))}

            <div className="border-t mt-1 pt-1 dark:border-gray-700">
              <button
                type="button"
                onClick={goToCreate}
                className="flex items-center w-full px-2 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                <span>{t('createNew')}</span>
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
