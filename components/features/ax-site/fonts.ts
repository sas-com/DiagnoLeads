import { Lato, Noto_Sans_JP } from 'next/font/google';

/**
 * Fonts of the AX migration site (same as maru2-dx.com).
 * next/font serves them from this app, which the production CSP (font-src 'self') requires.
 * Noto Sans JP is used from 1024px or with a mouse; on phones and touch tablets below 1024px the
 * Japanese text takes the device's font and none of its files load (app/globals.css, #510,
 * decision 2026-10-26-ax-device-font-on-mobile).
 */
const notoSansJp = Noto_Sans_JP({
  // The variable font (no weight): one @font-face per unicode-range file instead of one per
  // weight. Google serves the same variable files either way, so the glyphs and downloads stay
  // the same while the render-blocking CSS shrinks from 372 rules to 124 (#510)
  subsets: ['latin'],
  display: 'swap',
  // Japanese glyphs come in many unicode-range files; let the browser fetch what it needs (and,
  // on phones, nothing: a preload would fetch a file there too)
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
