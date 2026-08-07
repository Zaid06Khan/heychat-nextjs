'use client';

import { entities } from '@/lib/shim/entities';
import { Core } from '@/lib/shim/integrations';

/**
 * Compatibility layer.
 *
 * Every component in this app imports `base44` from here. Keeping the export
 * name and shape identical is what let the port happen without editing them —
 * the file path and the symbol are the seam, and everything behind it changed.
 *
 * The @base44/sdk package is gone. This object is backed entirely by Supabase.
 */
export const base44 = {
  entities,

  integrations: {
    Core,
  },

  /**
   * Base44's hosted auth. Deliberately not reimplemented here: authentication
   * now lives in `@/lib/heychatAuth` (backed by /api/auth/* route handlers) so
   * that password handling stays on the server.
   *
   * The only remaining caller is src/screens/ResetPassword.jsx, which is dead
   * code — App.jsx has no route for it, and its emailed-reset-token flow never
   * applied to an app with no email addresses. This stub exists so the file
   * still resolves; delete the page and this stub together.
   */
  auth: {
    resetPassword() {
      throw new Error(
        'base44.auth is no longer available. Use resetPasswordWithRecovery() from @/lib/heychatAuth.'
      );
    },
  },
};

export default base44;
