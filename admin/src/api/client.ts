import axios from 'axios';

import type { ApiErrorBody } from './types';

/**
 * Deliberately different storage keys from the player web app so an operator
 * session and a player session can coexist in the same browser.
 */
export const ADMIN_TOKEN_KEY = 'admin_token';
export const ADMIN_USER_KEY = 'admin_user';

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export function clearAdminSession(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
}

// --- Request: attach the admin JWT ------------------------------------------
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// --- Response: expired/invalid session --------------------------------------
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url ?? '';
      const isAuthCall = url.includes('/auth/login');

      if (!isAuthCall && window.location.pathname !== '/login') {
        clearAdminSession();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

/** Prefers the API's `{ error: { message } }` envelope. */
export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;

    if (body?.error?.message) {
      return body.error.message;
    }

    if (error.response?.status === 403) {
      return 'Administrator role required.';
    }

    if (!error.response) {
      return 'Cannot reach the server. Is the API running on port 3000?';
    }
  }

  return fallback;
}
