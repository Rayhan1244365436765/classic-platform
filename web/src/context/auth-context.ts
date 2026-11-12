import { createContext, useContext } from 'react';

import type { AuthUser } from '../api/types';

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Persist the session returned by POST /auth/login. */
  login: (token: string, user: AuthUser) => void;
  /** Clear the session (also used by the 401 interceptor). */
  logout: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Access the current session. Must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
