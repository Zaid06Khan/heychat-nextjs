import ClientApp from '../client-app';

/**
 * Optional catch-all: every path that isn't /api/* renders the SPA, which then
 * routes client-side exactly as it did under Vite. Deep links like
 * /chat/<id> therefore keep working on a hard refresh.
 */
export default function Page() {
  return <ClientApp />;
}
