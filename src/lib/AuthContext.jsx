'use client';

import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getCurrentAccount, logout as heychatLogout, clearSession } from '@/lib/heychatAuth';

/**
 * Replaces the Base44 version of this file.
 *
 * The original existed to talk to Base44's platform: it fetched
 * `/api/apps/public/.../public-settings` to discover whether the hosted app
 * required auth, then called `base44.auth.me()`. None of that has a counterpart
 * in a self-hosted build — there is no platform to ask permission from.
 *
 * The context keys are kept identical (`isLoadingPublicSettings`, `authError`,
 * `isAuthenticated`, …) because App.jsx renders a spinner off
 * `isLoadingPublicSettings`. Now they describe *our* auth state instead of
 * Base44's. `appPublicSettings` is retained as null so any reader still resolves.
 */

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const account = await getCurrentAccount();
      setUser(account);
      setIsAuthenticated(Boolean(account));
      setAuthError(null);
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError({ type: 'unknown', message: error?.message || 'Auth check failed' });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    // There is no remote app config to load any more; this resolves immediately
    // and exists only so the flag App.jsx waits on still flips.
    setIsLoadingPublicSettings(false);
    await checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  // Keep React state in step when the session is refreshed or revoked in
  // another tab.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearSession();
        setUser(null);
        setIsAuthenticated(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        checkUserAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, [checkUserAuth]);

  const logout = useCallback(async (shouldRedirect = true) => {
    await heychatLogout();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect && typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, []);

  const navigateToLogin = useCallback(() => {
    if (typeof window !== 'undefined') window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings: null,
        authChecked,
        logout,
        navigateToLogin,
        checkUserAuth,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
