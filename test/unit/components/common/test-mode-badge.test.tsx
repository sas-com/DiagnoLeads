/**
 * Header badge for test mode (real next-intl messages, tRPC mocked) and the endpoint behind it
 */
import { TestModeBadge } from '@/components/common/TestModeBadge';
import messages from '@/locales/ja/common.json';
import { appRouter } from '@/server/routers/_app';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { health: { testMode: { useQuery: () => ({ data: mocks.data }) } } },
}));

const renderBadge = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <TestModeBadge />
    </NextIntlClientProvider>
  );

describe('TestModeBadge', () => {
  it('shows "テストモード" with the accepted domains while test mode is on', () => {
    mocks.data = { testMode: true, domains: ['sas-com.com'] };
    renderBadge();

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('テストモード');
    expect(badge).toHaveTextContent('@sas-com.com 以外のメールアドレスは登録・送信できません');
  });

  it('shows nothing when test mode is off', () => {
    mocks.data = { testMode: false, domains: [] };
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('health.testMode', () => {
  afterEach(() => {
    delete process.env.APP_TEST_MODE;
  });

  it('reports the switch and the domains without signing in', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal tRPC context for the test
    const caller = appRouter.createCaller({ db: {}, session: null, user: null } as any);
    expect(await caller.health.testMode()).toEqual({ testMode: false, domains: [] });

    process.env.APP_TEST_MODE = 'true';
    expect(await caller.health.testMode()).toEqual({ testMode: true, domains: ['sas-com.com'] });
  });
});
