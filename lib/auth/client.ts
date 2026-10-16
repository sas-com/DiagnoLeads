import { createAuthClient } from 'better-auth/react';

/**
 * Client-side auth instance
 * Use this in React components for authentication
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Export hooks and utilities for use in components
 */
export const { useSession, signIn, signOut, signUp } = authClient;
