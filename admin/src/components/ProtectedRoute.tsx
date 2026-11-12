import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

import { ADMIN_TOKEN_KEY } from '../api/client';

/**
 * Gate for the dashboard.
 *
 * The admin app has no auth context: the only thing that matters is whether an
 * admin token exists. Route-level checks keep it stateless and simple; the API
 * rejects anything invalid or non-admin anyway (401 / 403).
 */
export function ProtectedRoute({ children }: { children: ReactElement }) {
  const hasToken = Boolean(localStorage.getItem(ADMIN_TOKEN_KEY));

  if (!hasToken) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;
