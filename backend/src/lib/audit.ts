/**
 * Audit logger.
 *
 * For MVP we write directly to `audit_logs` (no queue yet). When traffic
 * grows, swap to BullMQ-backed worker — the public API stays the same.
 *
 * Use the middleware to capture HTTP mutations automatically, or call
 * `audit.write()` from service code for domain events (transaction
 * approved, user invited, etc.).
 */
import type { MiddlewareHandler } from 'hono';
import { asSuperAdmin } from '../db/client.js';
import { auditLogs } from '../db/schema/audit.js';
import { logger } from '../lib/logger.js';
import type { SessionVars } from '../middleware/session.js';
import type { TenantVars } from '../middleware/tenant.js';

export interface AuditEvent {
  tenantId?: string | null;
  userId?: string | null;
  action: string; // e.g. 'POST /api/v1/transactions' or 'transaction.approve'
  resource?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** Write a single audit event. Fire-and-forget — never throws. */
export async function write(event: AuditEvent): Promise<void> {
  try {
    await asSuperAdmin(async (tx) => {
      await tx.insert(auditLogs).values({
        tenantId: event.tenantId ?? null,
        userId: event.userId ?? null,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: (event.metadata as Record<string, unknown>) ?? null,
      });
    });
  } catch (err) {
    logger.warn({ err, event }, 'audit write failed');
  }
}

/**
 * Middleware: audit every successful mutation (POST/PUT/PATCH/DELETE).
 * Skips GETs (too noisy) and 4xx/5xx responses (the action did not occur).
 */
export const auditInterceptor = (): MiddlewareHandler<{
  Variables: SessionVars & TenantVars;
}> =>
  async (c, next) => {
    await next();

    const method = c.req.method;
    if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return;
    if (c.res.status >= 400) return;

    // Skip auth routes — better-auth has its own logging surface.
    if (c.req.path.startsWith('/api/auth/')) return;

    // Fire and forget; do not await.
    void write({
      tenantId: c.get('tenantId') ?? null,
      // Map auth user → app user via authUserId; here we just capture the
      // auth-side identity. Service code can resolve to users.id when needed.
      userId: null,
      action: `${method} ${c.req.path}`,
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: c.req.header('user-agent'),
      metadata: {
        authUserId: c.get('user')?.id,
        status: c.res.status,
      },
    });
  };

export const audit = { write };
