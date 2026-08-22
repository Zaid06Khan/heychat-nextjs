/**
 * Entry point for the bundled app.
 *
 * This is what `src/app/layout.jsx` and `src/app/client-app.jsx` do on the web,
 * minus Next: load the fonts, load the stylesheet, mount <App/>.
 *
 * ORDER MATTERS. The fonts declare the families, `fonts.css` binds them to the
 * two custom properties `index.css` already reads, and `index.css` comes last
 * so nothing it sets is overwritten.
 */
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/plus-jakarta-sans';
import './fonts.css';
import '@/index.css';

import { createRoot } from 'react-dom/client';
import App from '@/App';

/**
 * No StrictMode, deliberately.
 *
 * It double-invokes effects in development, and this app's effects open
 * Realtime channels and peer connections — `watchForCalls` already carries a
 * token specifically because React tears one run down while another is
 * starting. Doubling that on a phone would be debugging a problem the shipped
 * app does not have. The web build does not use it either.
 */
createRoot(document.getElementById('root')).render(<App />);
