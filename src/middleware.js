import { NextResponse } from 'next/server';

/**
 * CORS for the API, and only for the native app.
 *
 * WHY THIS EXISTS AT ALL. On the web the client and the API share an origin, so
 * none of this is needed and nothing here fires. Bundled into the app the client
 * runs from `capacitor://localhost` (iOS) or `https://localhost` (Android, via
 * `androidScheme`), and every call to the deployed API is cross-origin. Without
 * a matching `Access-Control-Allow-Origin` the browser inside the WebView
 * refuses the response before any code sees it — the request succeeds on the
 * server and the app reports a network error, which is a miserable thing to
 * debug.
 *
 * AN ALLOWLIST, NOT A WILDCARD. `*` would let any website call this API with a
 * token it had somehow obtained; more practically it is the setting nobody ever
 * tightens afterwards. These three origins are the only ones the app can
 * present, and each is a fixed string rather than a pattern.
 *
 * `Authorization` is the header that matters. It is not a CORS-safelisted
 * request header, so a cross-origin request carrying a bearer token triggers a
 * preflight — which is why OPTIONS is answered here rather than falling through
 * to a route handler that would 405 it.
 *
 * NO `Access-Control-Allow-Credentials`. The native app authenticates with the
 * bearer token precisely because its cookies do not travel, so allowing
 * credentials would grant something nothing uses and widen what a stolen origin
 * could do.
 */
const ALLOWED_ORIGINS = new Set([
  // iOS WKWebView, Capacitor's default scheme.
  'capacitor://localhost',
  // Android, because capacitor.config.json sets androidScheme to https.
  'https://localhost',
  // A local Vite preview of the bundle, so the same path can be exercised on a
  // desktop before it is packaged. `npm run test:bundle` serves on 4173.
  'http://localhost:4173',
]);

/** Headers a real browser will accept as permission to read the response. */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    // A day, so the preflight is paid once rather than before every call. The
    // allowlist is static, so there is nothing for a stale cache to get wrong.
    'Access-Control-Max-Age': '86400',
    // The answer differs by Origin, and a cache that ignored that would serve
    // one app's headers to another.
    Vary: 'Origin',
  };
}

export function middleware(request) {
  const origin = request.headers.get('origin');

  // Same-origin requests send no Origin header at all for GET, and one that
  // matches for POST — either way the web app needs nothing added.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    // A disallowed origin is NOT rejected here. It is answered without the
    // header, and the browser is what refuses to hand the response over — which
    // is how CORS is meant to work. Blocking here would also block every
    // non-browser caller, including both test suites.
    return NextResponse.next();
  }

  if (request.method === 'OPTIONS') {
    // 204, and no body: a preflight is asking for permission, not for content.
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * The API only. The SPA catch-all serves HTML to a browser that is already on
 * the origin, and running this on every page would add work to every request
 * for nothing.
 */
export const config = {
  matcher: '/api/:path*',
};
