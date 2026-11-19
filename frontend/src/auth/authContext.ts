import { createContext, useContext } from 'react';

type AuthResult = { ok: true } | { ok: false; error: string };

interface AuthContextValue {
  token: string;
  email: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (email: string, password: string, name?: string) => Promise<AuthResult>;
  logout: () => void;
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { AuthContext, useAuth };
export type { AuthContextValue, AuthResult };
