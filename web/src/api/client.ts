import axios from 'axios';

import type { ApiErrorBody } from './types';

/** localStorage keys shared with the auth context. */
export const TOKEN_STORAGE_KEY = 'token';
export const USER_STORAGE_KEY = 'user';

/**
 * Base URL of the REST API.
 * Override with `VITE_API_URL` in `web/.env` when the API is not on localhost.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// --- Request: attach the JWT from localStorage -------------------------------
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// --- Response: a 401 means the session is gone -------------------------------
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url ?? '';
      const isAuthCall = url.includes('/auth/login') || url.includes('/auth/register');
      const alreadyOnLogin = window.location.pathname === '/login';

      // A failed login also returns 401 — only force a redirect when a real
      // session expired, otherwise the login form would lose its error message.
      if (!isAuthCall && !alreadyOnLogin) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

/**
 * Turns any thrown value into a message suitable for display.
 * Prefers the API's `{ error: { message } }` envelope.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;

    if (body?.error?.message) {
      return body.error.message;
    }

    if (!error.response) {
      return 'Cannot reach the server. Is the API running on port 3000?';
    }
  }

  return fallback;
}
