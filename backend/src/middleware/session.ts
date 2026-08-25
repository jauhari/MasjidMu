/**
 * Session middleware — reads better-auth session from cookie and exposes it.
 *
 * Routes that need authentication should also use `requireSession()`. Routes
 * that don't care (e.g. public landing) can omit this middleware entirely.
 */
import type { MiddlewareHandler } from 'hono';
import { auth, type Session } from '../lib/auth.js';
import { syncUserAuthId } from '../lib/user-mapping.js';
import { memGet, memSet } from '../lib/memory-cache.js';

export type SessionVars = {
  session?: Session['session'];
  user?: Session['user'];
};

export const sessionResolver = (): MiddlewareHandler<{ Variables: SessionVars }> =>
  async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session) {
        c.set('session', session.session);
        c.set('user', session.user);

        // Sync authUserId to app-side users table if not synced recently
        const syncKey = `user-synced:${session.user.id}`;
        if (!memGet(syncKey)) {
          await syncUserAuthId({
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            image: session.user.image,
          });
          memSet(syncKey, '1', 300); // 5 min cache
        }
      }
    } catch {
      // No session / invalid cookie — leave vars unset.
    }
    await next();
  };

export const requireSession = (): MiddlewareHandler<{ Variables: SessionVars }> =>
  async (c, next) => {
    if (!c.get('user')) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    return next();
  };
