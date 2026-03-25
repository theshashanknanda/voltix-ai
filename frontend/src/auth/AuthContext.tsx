import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from '../config';

type AuthResult = { ok: true } | { ok: false; error: string };

interface AuthContextValue {
  token: string;
  email: string;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (email: string, password: string, name?: string) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const tokenKey = 'voltix_token';
const emailKey = 'voltix_email';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) || '');
  const [email, setEmail] = useState(() => localStorage.getItem(emailKey) || '');

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

  const logout = () => {
    setToken('');
    setEmail('');
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(emailKey);
  };

  const value = useMemo(
    () => ({ token, email, isAuthenticated: Boolean(token), login, register, logout }),
    [token, email],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
