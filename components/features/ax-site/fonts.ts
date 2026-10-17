import { Lato, Noto_Sans_JP } from 'next/font/google';

/**
 * Fonts of the AX migration site (same as maru2-dx.com).
 * next/font serves them from this app, which the production CSP (font-src 'self') requires.
 */
const notoSansJp = Noto_Sans_JP({
  // Only the weights in use: every weight adds a set of unicode-range files to the CSS
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  // Japanese glyphs come in many unicode-range files; let the browser fetch what it needs
  preload: false,
  variable: '--font-noto-sans-jp',
});

const lato = Lato({
  // Latin accents (labels, numbers) are bold or black only
  weight: ['700', '900'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-lato',
});

/** Put on the site's root element: defines the variables used by font-ax / font-ax-latin */
export const axFontVariables = `${notoSansJp.variable} ${lato.variable}`;
