import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { API_BASE_URL } from '../config';
import { AuthContext, type AuthContextValue } from './authContext';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const unavailable = 'Sign-in is temporarily unavailable. Please try again later.';

function AuthSession({ children }: { children: ReactNode }) {
  const auth0 = useAuth0();
  const { getAccessTokenSilently, loginWithRedirect, logout: auth0Logout } = auth0;
  const [session, setSession] = useState({ token: '', email: '', error: '' });
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    let canceled = false;
    const sync = async () => {
      if (auth0.isLoading) return;
      if (!auth0.isAuthenticated || auth0.error) {
        setSession({ token: '', email: '', error: auth0.error ? 'Sign-in was canceled or could not be completed. Please try again.' : '' });
        setSyncing(false);
        return;
      }
      setSyncing(true);
      try {
        const token = await getAccessTokenSilently();
        if (!token) throw new Error('Unauthorized. Please login again.');
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || unavailable);
        if (!canceled) setSession({ token, email: data.user.email, error: '' });
      } catch (error) {
        if (!canceled) setSession({ token: '', email: '', error: error instanceof Error ? error.message : unavailable });
      } finally { if (!canceled) setSyncing(false); }
    };
    void sync();
    return () => { canceled = true; };
  }, [auth0.isLoading, auth0.isAuthenticated, auth0.error, getAccessTokenSilently]);

  const apiFetch = useCallback(async (input: string, init?: RequestInit) => {
    let token: string;
    try {
      const accessToken = await getAccessTokenSilently();
      if (!accessToken) throw new Error('Missing access token');
      token = accessToken;
    } catch {
      setSession({ token: '', email: '', error: 'Unauthorized. Please login again.' });
      throw new Error('Unauthorized. Please login again.');
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401) setSession({ token: '', email: '', error: 'Unauthorized. Please login again.' });
    return response;
  }, [getAccessTokenSilently]);

  const value: AuthContextValue = {
    ...session, configured: true,
    isLoading: auth0.isLoading || syncing,
    isAuthenticated: auth0.isAuthenticated && Boolean(session.token) && !auth0.error,
    apiFetch,
    login: async provider => {
      try {
        await loginWithRedirect({ authorizationParams: { connection: provider, prompt: 'select_account' } });
        return { ok: true };
      } catch { return { ok: false, error: unavailable }; }
    },
    logout: () => {
      setSession({ token: '', email: '', error: '' });
      void auth0Logout({ logoutParams: { returnTo: `${window.location.origin}/auth` } }).catch(() => {
        setSession({ token: '', email: '', error: 'You are signed out here. Sign-in service is temporarily unavailable.' });
      });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    localStorage.removeItem('voltix_token');
    localStorage.removeItem('voltix_email');
  }, []);
  if (!domain || !clientId || !audience) {
    return <AuthContext.Provider value={{
      token: '', email: '', isAuthenticated: false, isLoading: false, error: unavailable, configured: false,
      login: async () => ({ ok: false, error: unavailable }), logout: () => {},
      apiFetch: async () => { throw new Error(unavailable); },
    }}>{children}</AuthContext.Provider>;
  }
  return <Auth0Provider domain={domain} clientId={clientId}
    authorizationParams={{ redirect_uri: `${window.location.origin}/auth`, audience, scope: 'openid profile email' }}
    cacheLocation="memory"
  ><AuthSession>{children}</AuthSession></Auth0Provider>;
}
