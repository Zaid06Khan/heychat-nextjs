/**
 * A SECRET KEY MUST NEVER BE IN A `NEXT_PUBLIC_` VARIABLE.
 *
 * Next inlines every `NEXT_PUBLIC_*` value into the browser bundle at build
 * time, so putting a secret there publishes it to everyone who loads the app —
 * and a Supabase secret key bypasses row-level security completely.
 *
 * This is not hypothetical. On 2026-08-19, during the key rotation, the
 * publishable and secret keys were swapped in Vercel and the secret shipped
 * inside two JavaScript chunks. It was caught by Supabase refusing the request
 * ("Forbidden use of secret API key in browser") rather than by anything here,
 * after a deploy and two failed diagnoses. Five lines would have stopped it at
 * the build.
 */
function assertNoSecretsInPublicEnv() {
  const offenders = Object.entries(process.env)
    .filter(([name, value]) =>
      name.startsWith('NEXT_PUBLIC_') && typeof value === 'string' && value.startsWith('sb_secret_')
    )
    .map(([name]) => name);

  if (offenders.length > 0) {
    throw new Error(
      [
        `Refusing to build: ${offenders.join(', ')} contains a Supabase SECRET key.`,
        'Anything named NEXT_PUBLIC_* is inlined into the browser bundle and is public.',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY takes the sb_publishable_ key; the sb_secret_',
        'key belongs in SUPABASE_SERVICE_ROLE_KEY, which is server-only.',
      ].join('\n')
    );
  }
}

assertNoSecretsInPublicEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Running `next build` while `npm run dev` is live overwrites .next, and the
  // dev server then throws `Cannot find module './873.js'` and
  // `ENOENT: fallback-build-manifest.json` — which reads exactly like a code
  // bug and is not one. This has cost real time more than once.
  //
  // So: verify a build without touching the dev server's output with
  // `BUILD_DIR=.next-verify npx next build`. There is no --distDir CLI flag,
  // which is why it has to come through config.
  distDir: process.env.BUILD_DIR || '.next',

  // The ported UI is still a React Router SPA mounted under a catch-all route
  // (see src/app/[[...slug]]/page.jsx). Nothing is prerendered yet, so no image
  // domains or rewrites are needed. Migrating screens to real App Router routes
  // is a follow-up — see FOLLOWUPS.md.
};

export default nextConfig;
