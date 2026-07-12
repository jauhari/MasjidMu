/**
 * better-auth Vue client — only used for the Google OAuth redirect handoff.
 * Email/password login still goes through `shared/api/client.ts` (custom
 * fetch wrapper, same-origin `/api/*` so the Cloudflare Pages proxy and Vite
 * dev proxy both just work). No explicit baseURL: defaults to
 * `window.location.origin`, matching that same same-origin assumption.
 *
 * Narrow return type on purpose: createAuthClient()'s full inferred type
 * pulls in an unnamed @better-auth/core/oauth2 type (TS2742) across this
 * monorepo's pnpm layout. We only ever call `signIn.social`, so that's all
 * the surface we assert here — widen it (and drop the cast) if a future
 * change needs more of the client.
 */
import { createAuthClient } from 'better-auth/vue';

interface AuthClient {
  signIn: {
    social: (opts: { provider: 'google'; callbackURL?: string }) => Promise<unknown>;
  };
}

export const authClient = createAuthClient() as unknown as AuthClient;
