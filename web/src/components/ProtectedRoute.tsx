import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';

/**
 * Blocks a route until a session exists.
 * Unauthenticated visitors are redirected to /login (replacing the history entry
 * so the back button does not bounce them around).
 */
export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;
