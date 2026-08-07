/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The ported UI is still a React Router SPA mounted under a catch-all route
  // (see src/app/[[...slug]]/page.jsx). Nothing is prerendered yet, so no image
  // domains or rewrites are needed. Migrating screens to real App Router routes
  // is a follow-up — see FOLLOWUPS.md.
};

export default nextConfig;
