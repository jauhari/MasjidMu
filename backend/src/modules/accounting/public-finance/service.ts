import { and, eq, isNull } from 'drizzle-orm';
import { asSuperAdmin, withTenant } from '../../../db/client.js';
import { tenants, users } from '../../../db/schema/core.js';
import { publicFinanceReports } from '../../../db/schema/accounting.js';
import { mosqueProfiles } from '../../../db/schema/organization.js';
import { memClearPrefix, memGet, memSet } from '../../../lib/memory-cache.js';
import { buildCashFlow } from '../reports/services/cash-flow.js';
import { buildTopCategories } from '../reports/services/category-breakdown.js';
import { buildMonthlyTrend } from '../reports/services/monthly-trend.js';
import { buildMovements } from '../reports/services/movements.js';
import type { ReportPeriod } from '../reports/types.js';
import type { PublicFinanceReportResponse } from './types.js';

const CACHE_TTL_SEC = 5 * 60;

export class PublicFinanceUnavailableError extends Error {
  constructor() {
    super('public_report_unavailable');
    this.name = 'PublicFinanceUnavailableError';
  }
}

function periodKey(period: ReportPeriod): string {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(period.startDate)}-${fmt(period.endDate)}`;
}

export async function invalidatePublicFinanceCache(tenantId: string): Promise<number> {
  return memClearPrefix(`public-finance:${tenantId}:`);
}

export async function getPublicFinanceStatus(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        isPublished: publicFinanceReports.isPublished,
        publishedAt: publicFinanceReports.publishedAt,
        revokedAt: publicFinanceReports.revokedAt,
        updatedAt: publicFinanceReports.updatedAt,
      })
      .from(publicFinanceReports)
      .where(eq(publicFinanceReports.tenantId, tenantId));
    return row ?? null;
  });
}

async function appUserIdForAuthUser(tenantId: string, authUserId: string): Promise<string | null> {
  return asSuperAdmin(async (tx) => {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.authUserId, authUserId), isNull(users.deletedAt)));
    return row?.id ?? null;
  });
}

export async function publishPublicFinance(args: { tenantId: string; actorAuthUserId: string }) {
  const { tenantId, actorAuthUserId } = args;
  const actorUserId = await appUserIdForAuthUser(tenantId, actorAuthUserId);
  const now = new Date();
  const published = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(publicFinanceReports)
      .values({
        tenantId,
        isPublished: true,
        publishedAt: now,
        publishedBy: actorUserId,
        revokedAt: null,
        revokedBy: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: publicFinanceReports.tenantId,
        set: {
          isPublished: true,
          publishedAt: now,
          publishedBy: actorUserId,
          revokedAt: null,
          revokedBy: null,
          updatedAt: now,
        },
      })
      .returning();
    return row!;
  });
  await invalidatePublicFinanceCache(tenantId);
  return published;
}

export async function revokePublicFinance(args: { tenantId: string; actorAuthUserId: string }) {
  const { tenantId, actorAuthUserId } = args;
  const actorUserId = await appUserIdForAuthUser(tenantId, actorAuthUserId);
  const now = new Date();
  const revoked = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(publicFinanceReports)
      .set({ isPublished: false, revokedAt: now, revokedBy: actorUserId, updatedAt: now })
      .where(eq(publicFinanceReports.tenantId, tenantId))
      .returning();
    return row ?? null;
  });
  await invalidatePublicFinanceCache(tenantId);
  return revoked;
}

async function loadPublishedConfig(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        isPublished: publicFinanceReports.isPublished,
        publishedAt: publicFinanceReports.publishedAt,
        updatedAt: publicFinanceReports.updatedAt,
      })
      .from(publicFinanceReports)
      .where(eq(publicFinanceReports.tenantId, tenantId));
    if (!row || !row.isPublished || !row.publishedAt) return null;
    return { ...row, publishedAt: row.publishedAt };
  });
}

export async function buildPublicFinanceReport(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<PublicFinanceReportResponse> {
  const { tenantId, period } = args;
  const config = await loadPublishedConfig(tenantId);
  if (!config) throw new PublicFinanceUnavailableError();

  const cacheKey = `public-finance:${tenantId}:${config.updatedAt.toISOString()}:${periodKey(period)}`;
  const cached = memGet<PublicFinanceReportResponse>(cacheKey);
  if (cached) return cached;

  const [tenantIdentity, profile, cashFlow, categories, monthlyTrend, movements] = await Promise.all([
    asSuperAdmin(async (tx) => {
      const [row] = await tx
        .select({ name: tenants.name, shortName: tenants.shortName })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return row ?? null;
    }),
    withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          officialName: mosqueProfiles.officialName,
          shortName: mosqueProfiles.shortName,
          logoUrl: mosqueProfiles.logoUrl,
          bannerUrl: mosqueProfiles.bannerUrl,
        })
        .from(mosqueProfiles)
        .where(eq(mosqueProfiles.tenantId, tenantId));
      return row ?? null;
    }),
    buildCashFlow({ tenantId, period }),
    buildTopCategories({ tenantId, period }),
    buildMonthlyTrend({ tenantId }),
    buildMovements({ tenantId, period }),
  ]);

  const response: PublicFinanceReportResponse = {
    reportType: 'finance-transparency',
    mosque: {
      name: profile?.officialName || tenantIdentity?.name || 'Lembaga',
      shortName: profile?.shortName || tenantIdentity?.shortName || null,
      logoUrl: profile?.logoUrl ?? null,
      bannerUrl: profile?.bannerUrl ?? null,
    },
    period,
    publication: { publishedAt: config.publishedAt.toISOString() },
    generatedAt: new Date().toISOString(),
    data: {
      cashPosition: cashFlow.closingCash,
      topIncome: categories.income,
      topExpense: categories.expense,
      monthlyTrend,
      movements,
    },
  };
  memSet(cacheKey, response, CACHE_TTL_SEC);
  return response;
}
