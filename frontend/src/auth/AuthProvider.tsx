import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from '../config';
import { AuthContext, type AuthContextValue, type AuthResult } from './authContext';

const tokenKey = 'voltix_token';
const emailKey = 'voltix_email';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) || '');
  const [email, setEmail] = useState(() => localStorage.getItem(emailKey) || '');

  const logout = useCallback(() => {
    setToken('');
    setEmail('');
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(emailKey);
  }, []);

  const login = async (userEmail: string, password: string): Promise<AuthResult> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Login failed' };
      }

      setToken(data.token);
      setEmail(userEmail);
      localStorage.setItem(tokenKey, data.token);
      localStorage.setItem(emailKey, userEmail);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Login failed' };
    }
  };

  const register = async (userEmail: string, password: string, name?: string): Promise<AuthResult> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Registration failed' };
      }

      return await login(userEmail, password);
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Registration failed' };
    }
  };

  const apiFetch = useCallback(async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const activeToken = token || localStorage.getItem(tokenKey) || '';
    if (activeToken) headers.set('Authorization', `Bearer ${activeToken}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401) logout();
    return response;
  }, [token, logout]);

  const value: AuthContextValue = {
    token,
    email,
    isAuthenticated: Boolean(token),
    isLoading: false,
    login,
    register,
    logout,
    apiFetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
