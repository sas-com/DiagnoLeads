import { messages } from '@/lib/i18n/messages';
import { withThemeByClassName } from '@storybook/addon-themes';
import type { Decorator, Preview } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import './preview.css';

/**
 * Every story is drawn as on an admin screen: inside .dl-admin, which turns the brand scale into
 * DADS Green, the grays into DADS Solid Gray and the focus into the DADS focus (app/globals.css),
 * and with the Japanese messages of the app.
 */
const withAdminScreen: Decorator = (Story) => (
  <NextIntlClientProvider locale="ja" messages={messages.ja} timeZone="Asia/Tokyo">
    <div className="dl-admin bg-white p-6 text-gray-900 dark:bg-gray-900 dark:text-gray-50">
      <Story />
    </div>
  </NextIntlClientProvider>
);

const preview: Preview = {
  // Every component gets a Docs page from its stories (the foundation pages opt out)
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    nextjs: { appDirectory: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      storySort: { order: ['はじめに', '基礎', '部品'] },
    },
    // Fail the accessibility panel's checks loudly in the UI, never silently
    a11y: { test: 'todo' },
  },
  decorators: [
    withAdminScreen,
    // The app switches to dark with the class on <html> (@custom-variant dark, app/globals.css)
    withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
  ],
};

export default preview;
