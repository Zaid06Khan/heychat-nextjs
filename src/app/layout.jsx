import { Bricolage_Grotesque, Plus_Jakarta_Sans } from 'next/font/google';
import '@/index.css';

/**
 * These are the first fonts this app has ever actually loaded. index.css had
 * declared Space Grotesk and Inter since the Base44 build, but nothing fetched
 * them — no next/font, no <link>, no @font-face — so every heading silently
 * fell through to the system sans.
 *
 * Bricolage Grotesque is the display face: chunky, variable-width, used on
 * names, balances and empty states. Plus Jakarta Sans carries body and UI.
 *
 * The Bodega spec names General Sans for body, which is Fontshare rather than
 * Google. Plus Jakarta stands in — same geometric neo-grotesque register, and
 * it is what the approved mock was judged on. Swapping in the real thing later
 * means downloading the woff2 and switching to next/font/local; nothing else
 * in the app refers to the family by name.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--f-display',
  display: 'swap',
});

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--f-body',
  display: 'swap',
});

export const metadata = {
  title: 'Calamus3',
  description: 'Private messaging. No phone number. No email. Just you.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Calamus3',
    // NOT 'black-translucent'. That one lets the page paint under the status
    // bar, which looks more native only if every screen also pads itself by
    // env(safe-area-inset-top) — and none of them do, so the clock would sit on
    // top of the chat header. 'default' keeps the bar reserved, and dark text
    // on it is correct against a Paper-coloured app.
    statusBarStyle: 'default',
  },
  other: {
    // `appleWebApp.capable` emits the STANDARDISED `mobile-web-app-capable`,
    // which is right — but Safari before iOS 15.4 only understands the
    // apple-prefixed spelling, and without it those versions open the app in a
    // browser tab from the home screen instead of full-screen. Emitting both
    // costs one tag.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport = {
  themeColor: '#FFFDF7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  // No `dark` class any more — Bodega is a light theme and index.css carries a
  // single palette. See the note at the top of that file.
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
