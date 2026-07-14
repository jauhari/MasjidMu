import { and, eq, isNull } from 'drizzle-orm';
import { asSuperAdmin, withTenant } from '../../../db/client.js';
import { tenants, users } from '../../../db/schema/core.js';
import { funds, publicPapReports } from '../../../db/schema/accounting.js';
import { mosqueProfiles } from '../../../db/schema/organization.js';
import { memClearPrefix, memGet, memSet } from '../../../lib/memory-cache.js';
import { buildFundLedger, FundLedgerNotFoundError } from '../reports/services/fund-ledger.js';
import type { ReportPeriod } from '../reports/types.js';
import type { PublicPapReportResponse } from './types.js';

const CACHE_TTL_SEC = 5 * 60;

export class PublicPapUnavailableError extends Error {
  constructor() {
    super('public_report_unavailable');
    this.name = 'PublicPapUnavailableError';
  }
}

function periodKey(period: ReportPeriod): string {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(period.startDate)}-${fmt(period.endDate)}`;
}

export async function invalidatePublicPapCache(tenantId: string): Promise<number> {
  return memClearPrefix(`public-pap:${tenantId}:`);
}

export async function getPublicPapStatus(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        fundId: publicPapReports.fundId,
        isPublished: publicPapReports.isPublished,
        publishedAt: publicPapReports.publishedAt,
        revokedAt: publicPapReports.revokedAt,
        updatedAt: publicPapReports.updatedAt,
        fundCode: funds.code,
        fundName: funds.name,
        fundIsActive: funds.isActive,
      })
      .from(publicPapReports)
      .innerJoin(funds, eq(funds.id, publicPapReports.fundId))
      .where(eq(publicPapReports.tenantId, tenantId));
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

export async function publishPublicPap(args: { tenantId: string; fundId: string; actorAuthUserId: string }) {
  const { tenantId, fundId, actorAuthUserId } = args;
  const actorUserId = await appUserIdForAuthUser(tenantId, actorAuthUserId);
  const now = new Date();
  const published = await withTenant(tenantId, async (tx) => {
    const [fund] = await tx
      .select({ id: funds.id, code: funds.code, name: funds.name, isActive: funds.isActive })
      .from(funds)
      .where(and(eq(funds.tenantId, tenantId), eq(funds.id, fundId), isNull(funds.deletedAt)));
    if (!fund || !fund.isActive) return null;

    const [row] = await tx
      .insert(publicPapReports)
      .values({
        tenantId,
        fundId,
        isPublished: true,
        publishedAt: now,
        publishedBy: actorUserId,
        revokedAt: null,
        revokedBy: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: publicPapReports.tenantId,
        set: {
          fundId,
          isPublished: true,
          publishedAt: now,
          publishedBy: actorUserId,
          revokedAt: null,
          revokedBy: null,
          updatedAt: now,
        },
      })
      .returning();
    return { ...row!, fundCode: fund.code, fundName: fund.name };
  });
  await invalidatePublicPapCache(tenantId);
  return published;
}

export async function revokePublicPap(args: { tenantId: string; actorAuthUserId: string }) {
  const { tenantId, actorAuthUserId } = args;
  const actorUserId = await appUserIdForAuthUser(tenantId, actorAuthUserId);
  const now = new Date();
  const revoked = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(publicPapReports)
      .set({
        isPublished: false,
        revokedAt: now,
        revokedBy: actorUserId,
        updatedAt: now,
      })
      .where(eq(publicPapReports.tenantId, tenantId))
      .returning();
    return row ?? null;
  });
  await invalidatePublicPapCache(tenantId);
  return revoked;
}

async function loadPublishedConfig(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        fundId: publicPapReports.fundId,
        isPublished: publicPapReports.isPublished,
        publishedAt: publicPapReports.publishedAt,
        updatedAt: publicPapReports.updatedAt,
        fundName: funds.name,
        fundIsActive: funds.isActive,
      })
      .from(publicPapReports)
      .innerJoin(funds, eq(funds.id, publicPapReports.fundId))
      .where(and(eq(publicPapReports.tenantId, tenantId), isNull(funds.deletedAt)));
    if (!row || !row.isPublished || !row.publishedAt || !row.fundIsActive) return null;
    return { ...row, publishedAt: row.publishedAt };
  });
}

export async function buildPublicPapReport(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<PublicPapReportResponse> {
  const { tenantId, period } = args;
  const config = await loadPublishedConfig(tenantId);
  if (!config) throw new PublicPapUnavailableError();

  const cacheKey = `public-pap:${tenantId}:${config.updatedAt.toISOString()}:${periodKey(period)}`;
  const cached = memGet<PublicPapReportResponse>(cacheKey);
  if (cached) return cached;

  const [tenantIdentity, profile] = await Promise.all([
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
  ]);

  try {
    const ledger = await buildFundLedger({ tenantId, period, fundId: config.fundId });
    const response: PublicPapReportResponse = {
      reportType: 'pap-transparency',
      mosque: {
        name: profile?.officialName || tenantIdentity?.name || 'Lembaga',
        shortName: profile?.shortName || tenantIdentity?.shortName || null,
        logoUrl: profile?.logoUrl ?? null,
        bannerUrl: profile?.bannerUrl ?? null,
      },
      period,
      publication: {
        publishedAt: config.publishedAt.toISOString(),
      },
      generatedAt: new Date().toISOString(),
      data: {
        fundName: ledger.fundName,
        openingBalance: ledger.openingBalance,
        totalPenerimaan: ledger.totalPenerimaan,
        totalPenyaluran: ledger.totalPenyaluran,
        surplusDeficit: ledger.surplusDeficit,
        closingBalance: ledger.closingBalance,
        movements: ledger.movements.map((m, index) => ({
          sequence: index + 1,
          date: m.journalDate,
          direction: m.direction,
          label: m.direction === 'penerimaan' ? 'Penerimaan Dana PAP' : 'Penyaluran Dana PAP',
          amount: m.amount,
          runningBalance: m.runningBalance,
        })),
      },
    };
    memSet(cacheKey, response, CACHE_TTL_SEC);
    return response;
  } catch (err) {
    if (err instanceof FundLedgerNotFoundError) throw new PublicPapUnavailableError();
    throw err;
  }
}
