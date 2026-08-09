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
