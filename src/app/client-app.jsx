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
const App = dynamic(() => import('@/App'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
