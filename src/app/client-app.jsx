'use client';

import dynamic from 'next/dynamic';

/**
 * The ported UI is still a React Router SPA. It is loaded with `ssr: false`
 * because it calls BrowserRouter, reads localStorage during render
 * (`getSession()` in Landing.jsx and AuthGuard.jsx) and sets document direction
 * on import (i18n.applyDirection) — all of which need a real browser.
 *
 * This is deliberately a staging arrangement, not the destination. It gets the
 * app running on infrastructure you control without rewriting 30 screens in one
 * go; screens then migrate to real App Router routes one at a time. See
 * FOLLOWUPS.md.
 */
/**
 * The cold-start screen.
 *
 * THIS IS SERVER-RENDERED, which is the whole point. `ssr: false` still renders
 * the `loading` component into the initial HTML, so it is the first paint —
 * before the bundle has downloaded, before React has hydrated. A launched PWA
 * therefore opens on the mark and the name rather than on an empty page or a
 * bare spinner, which is most of what makes an installed app feel like one.
 *
 * It deliberately echoes the Landing screen's composition — same mark, same
 * wordmark, same ground — so the handover when the app mounts reads as the page
 * continuing rather than as one screen replacing another.
 *
 * No hooks and no browser APIs here: anything that touches `window` would move
 * this back out of the server render and reintroduce the blank frame.
 */
function Splash() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background gap-5">
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={112}
        height={112}
        className="w-28 h-28 object-contain select-none"
      />
      <p className="text-3xl font-display font-extrabold text-foreground tracking-tight">
        Calamus3
      </p>
      {/* Under the name, not over it: the mark is the thing to look at, and a
          spinner competing with it is what makes a launch feel slow. */}
      <div
        role="status"
        aria-label="Loading"
        className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin opacity-60"
      />
    </div>
  );
}

const App = dynamic(() => import('@/App'), {
  ssr: false,
  loading: () => <Splash />,
});

export default function ClientApp() {
  return <App />;
}
