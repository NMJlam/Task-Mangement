import { createAuthClient } from "better-auth/react";

/**
 * The auth client. It talks to our OWN backend at same-origin `/api/auth/*`
 * (the Vite dev proxy forwards `/api` to the backend), so the Better Auth
 * session cookie is first-party — `useSession` and protected fetches just work,
 * in every browser, with no cross-site cookie problems.
 */
export const authClient = createAuthClient({ baseURL: window.location.origin });
