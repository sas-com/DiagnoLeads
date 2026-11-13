import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/nextjs-vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Storybook of the design system (#1116): the foundations (colors, type, spacing, focus) and the
 * shared components of components/ui, drawn with the app's own stylesheet. Stories live in
 * stories/, outside the app, so that the Next.js build never sees them.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  core: { disableTelemetry: true },
  // tsconfig.json leaves stories/ and .storybook/ out (the Next.js build must not type-check
  // them), so the paths plugin does not resolve '@/' for them: name the alias here
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      alias: { ...viteConfig.resolve?.alias, '@': root },
    },
  }),
};

export default config;
