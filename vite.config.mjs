import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The MOBILE bundle. Next still builds and serves the web app and the whole API.
 *
 * WHY VITE AND NOT `next build`. Capacitor needs a directory of static files to
 * package into the app, and Next's `output: 'export'` refuses to run in a
 * project that has route handlers — which this one is mostly made of. Rather
 * than split the API into a second project, the SPA is built directly, which it
 * can be because it barely touches Next at all: the only `next/` imports in the
 * whole tree outside `src/app/` is `lib/supabase/server.js`, which is
 * server-only and never reaches a client bundle. Routing is react-router,
 * `components/ui/image` is a plain <img>, and nothing uses next/image.
 *
 * What `src/app/` provided, `mobile/` now provides instead: an HTML shell, the
 * fonts, and an entry point that mounts <App/>.
 *
 * THE OUTPUT IS `www/`, which is Capacitor's `webDir`.
 */

/** `.env.local` for a local build; real environment variables win, for CI. */
function localEnv() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );
  } catch {
    return {};
  }
}

const env = { ...localEnv(), ...process.env };

/**
 * The API is NOT same-origin here.
 *
 * The bundle runs from `capacitor://localhost`, so a relative `/api/...` would
 * resolve inside the app package and 404. `lib/api.js` prefixes every call with
 * this. It is also why the bearer token exists: a cookie for the deployed
 * origin is third-party from here and WKWebView blocks it outright.
 */
const API_ORIGIN = env.NEXT_PUBLIC_API_ORIGIN || 'https://calamus3.vercel.app';

/**
 * Only the values the client legitimately needs, named one by one.
 *
 * Deliberately NOT a blanket `process.env` replacement: that would inline
 * whatever happened to be in the environment of whoever ran the build, which is
 * how a service-role key ends up in a bundle. The same failure `next.config.mjs`
 * has a guard for, and it has already happened once here (2026-08-19).
 */
const publicEnv = {
  'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ''),
  'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''),
  'process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY': JSON.stringify(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''),
  'process.env.NEXT_PUBLIC_API_ORIGIN': JSON.stringify(API_ORIGIN),
  // Tells `lib/supabase/client.js` to keep the session in localStorage rather
  // than a cookie it could never read back.
  'process.env.NEXT_PUBLIC_CLIENT_TARGET': JSON.stringify('native'),
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
};

for (const [key, value] of Object.entries(publicEnv)) {
  if (key.includes('SUPABASE') && value === '""') {
    throw new Error(
      `Refusing to build the mobile bundle: ${key.replace('process.env.', '')} is empty.\n` +
        'A bundle without it installs fine and then cannot reach the database, which\n' +
        'looks like a broken app rather than a broken build.'
    );
  }
  if (/sb_secret_/.test(value)) {
    throw new Error(`Refusing to build: ${key} contains a Supabase SECRET key.`);
  }
}

export default defineConfig({
  root: 'mobile',
  // Next serves these at the root; Capacitor needs them copied in beside the
  // bundle — the logo the splash paints lives here.
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: publicEnv,
  build: {
    outDir: fileURLToPath(new URL('./www', import.meta.url)),
    emptyOutDir: true,
    // A phone is not a desktop on a fast connection; smaller chunks matter more
    // than fewer of them, and the source map would double the package size.
    sourcemap: false,
  },
});
