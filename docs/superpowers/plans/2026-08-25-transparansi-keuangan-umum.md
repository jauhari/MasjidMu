# Transparansi Keuangan Umum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a whole-lembaga financial summary (current cash position, biggest income category, biggest expense category) as a no-login public link, downloadable as a shareable PNG image for WhatsApp — alongside the existing fund-specific "Transparansi Dana PAP", without changing it.

**Architecture:** Mirror the proven `public-pap` module 1:1 (publish/revoke table + public read endpoint + admin control endpoints), swap the fund-ledger data source for a new category-grouped query plus the existing cash-flow report's closing balance, and add a Puppeteer PNG screenshot path alongside the existing PDF path.

**Tech Stack:** Hono, Drizzle ORM, Neon Postgres, Puppeteer (already a backend dependency), Vue 3 + Vite, Reka UI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-25-transparansi-keuangan-umum-design.md`
- Public endpoints/pages: no auth, `Cache-Control: no-store`, only summary figures (no voucher numbers, account names, transaction IDs, or internal notes) — same privacy bar as `public-pap`.
- Do not modify `public-pap` behavior except the one sanctioned refactor (extracting `getBrowser()` into a shared module).
- Reuse existing permissions `reports.read` / `reports.publish` — no new permission rows.
- Migration SQL must be idempotent (`CREATE TABLE IF NOT EXISTS`), additive only, numbered `097_`.
- All user-facing copy in Indonesian, matching existing tone in `ReportsView.vue` / `PublicPapView.vue`.
- This module has zero existing unit tests for report-builder query functions (`activity.ts`, `cash-flow.ts`, `balance-sheet.ts` are all untested) — follow that convention for the new query rather than introducing new test scaffolding; verify manually against real data instead (see Task 8).

---

### Task 1: Migration + schema for `public_finance_reports`

**Files:**
- Create: `backend/src/db/migrations/sql/097_public_finance_reports.sql`
- Modify: `backend/src/db/schema/accounting.ts` (add table + type export, near `publicPapReports` at line ~126)

**Interfaces:**
- Produces: Drizzle table `publicFinanceReports` with columns `tenantId` (PK, uuid), `isPublished` (bool), `publishedAt`/`publishedBy`/`revokedAt`/`revokedBy`, `createdAt`/`updatedAt` — no `fundId`. Exported type `PublicFinanceReport = typeof publicFinanceReports.$inferSelect`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 097_public_finance_reports.sql
-- Whole-tenant financial transparency publication (no fund required),
-- sibling to public_pap_reports (096) which requires a PSAK 109 fund.
CREATE TABLE IF NOT EXISTS public_finance_reports (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  is_published  boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  published_by  uuid REFERENCES users(id),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_finance_reports_is_published_idx
  ON public_finance_reports (is_published);
```

- [ ] **Step 2: Add the Drizzle table + type to `accounting.ts`**

Insert directly after the `publicPapReports` table definition (after its closing `);`):

```ts
// ─── Public general finance transparency (no fund required) ───────────────
export const publicFinanceReports = pgTable(
  'public_finance_reports',
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    isPublished: boolean().default(false).notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid().references(() => users.id),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publishedIdx: index().on(t.isPublished),
  }),
);
```

Add the type export next to `PublicPapReport` (near line 375):

```ts
export type PublicFinanceReport = typeof publicFinanceReports.$inferSelect;
```

- [ ] **Step 3: Apply the migration**

Run: `cd backend && pnpm db:migrate`
Expected: log shows `097_public_finance_reports.sql` applied, exits 0. If `DATABASE_URL` isn't available locally, apply via the Neon MCP `run_sql` tool against the project's database instead (same SQL as Step 1) — confirm first with `describe_table_schema` that `public_pap_reports` already exists on that database/branch, to make sure it's the right target.

- [ ] **Step 4: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: no errors related to `accounting.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/sql/097_public_finance_reports.sql backend/src/db/schema/accounting.ts
git commit -m "feat(reports): add public_finance_reports table for whole-lembaga transparency"
```

---

### Task 2: Category-breakdown query service

**Files:**
- Create: `backend/src/modules/accounting/reports/services/category-breakdown.ts`

**Interfaces:**
- Consumes: `ReportPeriod` from `../types.js` (`{ startDate: Date; endDate: Date; label: string; periodMonth: Date }`), `withTenant` from `../../../../db/client.js`.
- Produces: `buildTopCategories(args: { tenantId: string; period: ReportPeriod }): Promise<{ income: CategoryAmount[]; expense: CategoryAmount[] }>` where `CategoryAmount = { categoryId: string; categoryCode: string; categoryName: string; amount: string }`, sorted descending by amount, capped at 5 per direction.

- [ ] **Step 1: Implement the query**

```ts
/**
 * Top transaction categories by amount within a period — used by the
 * general finance transparency summary (posisi kas + kategori terbesar).
 * Groups by transaction_categories (not by COA account) so a thin chart of
 * accounts (e.g. one "Beban Program" account covering everything) doesn't
 * collapse every expense into a single uninformative line.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { ReportPeriod } from '../types.js';

export interface CategoryAmount {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  amount: string;
}

interface Row {
  category_id: string;
  category_code: string;
  category_name: string;
  direction: 'income' | 'expense';
  total: string;
}

async function fetchTopCategories(tenantId: string, period: ReportPeriod): Promise<Row[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT tc.id::text AS category_id,
             tc.code AS category_code,
             tc.name AS category_name,
             tc.direction::text AS direction,
             SUM(t.amount)::text AS total
        FROM transactions t
        JOIN transaction_categories tc ON tc.id = t.category_id
       WHERE t.tenant_id = ${tenantId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.transaction_date >= ${period.startDate.toISOString()}::timestamptz
         AND t.transaction_date <= ${period.endDate.toISOString()}::timestamptz
       GROUP BY tc.id, tc.code, tc.name, tc.direction
       ORDER BY SUM(t.amount) DESC
    `);
    return r.rows as unknown as Row[];
  });
}

export async function buildTopCategories(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<{ income: CategoryAmount[]; expense: CategoryAmount[] }> {
  const rows = await fetchTopCategories(args.tenantId, args.period);
  const toAmount = (r: Row): CategoryAmount => ({
    categoryId: r.category_id,
    categoryCode: r.category_code,
    categoryName: r.category_name,
    amount: new Decimal(r.total).toFixed(2),
  });
  return {
    income: rows.filter((r) => r.direction === 'income').slice(0, 5).map(toAmount),
    expense: rows.filter((r) => r.direction === 'expense').slice(0, 5).map(toAmount),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: no errors in `category-breakdown.ts`.

- [ ] **Step 3: Manual sanity check against real data**

Use the Neon MCP `run_sql` tool to run the same query by hand for PCA Ponjong's `tenant_id` for August 2026, and confirm the top expense category is `PCA-BEBAN-PROGRAM` and top income category is `PCA-INFAQ` (matches the categorization table in `docs/HANDOFF.md` §3) — both accounts/categories PCA Ponjong actually uses. This substitutes for automated tests per the Global Constraints note.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/accounting/reports/services/category-breakdown.ts
git commit -m "feat(reports): add category-breakdown query for top income/expense categories"
```

---

### Task 3: Shared Puppeteer browser + PNG image renderer

**Files:**
- Create: `backend/src/modules/accounting/reports/export/browser.ts`
- Modify: `backend/src/modules/accounting/reports/export/pdf.ts` (use the shared browser instead of its own)

**Interfaces:**
- Produces: `getSharedBrowser(): Promise<Browser>`, `closeSharedBrowser(): Promise<void>` from `browser.ts`.
- Consumes (by later tasks): `renderPngFromHtml(html: string, viewport: { width: number; height: number }): Promise<Buffer>` — also defined here since it's generic across any future image export, not just finance.

- [ ] **Step 1: Extract the shared browser + add a generic PNG renderer**

```ts
/**
 * Shared Puppeteer browser instance — reused by every export that needs
 * headless Chromium (PDF, PNG). One Chromium process only; pages are
 * created and closed per request.
 */
import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';

let browserPromise: Promise<Browser> | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/** Shut down the cached browser. Call from tests or graceful shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

export async function renderPngFromHtml(
  html: string,
  viewport: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png' });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 2: Point `pdf.ts` at the shared browser**

In `backend/src/modules/accounting/reports/export/pdf.ts`, replace the local `getBrowser`/`browserPromise`/`closeReportPdfBrowser` implementation (lines 14–24 and 43–50) with imports from `./browser.js`:

```ts
import { getSharedBrowser, closeSharedBrowser } from './browser.js';
```

Replace the `getBrowser()` call inside `renderReportPdf` with `getSharedBrowser()`, and re-export `closeReportPdfBrowser` as a thin alias so existing callers (if any, e.g. graceful shutdown) keep working:

```ts
export const closeReportPdfBrowser = closeSharedBrowser;
```

- [ ] **Step 3: Find and check existing callers of `closeReportPdfBrowser`**

Run: `cd backend && grep -rn "closeReportPdfBrowser" src`
Expected: only the definition and, if present, one call from a graceful-shutdown hook — confirm the alias satisfies that call site's import (no signature change, so it will).

- [ ] **Step 4: Typecheck and existing PDF export still works**

Run: `cd backend && pnpm typecheck`
Expected: no errors. This is a pure refactor — behavior of `renderReportPdf` and the public-pap PDF export must be unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/accounting/reports/export/browser.ts backend/src/modules/accounting/reports/export/pdf.ts
git commit -m "refactor(reports): extract shared Puppeteer browser for PDF + PNG export"
```

---

### Task 4: `public-finance` backend module (types, service, route)

**Files:**
- Create: `backend/src/modules/accounting/public-finance/types.ts`
- Create: `backend/src/modules/accounting/public-finance/service.ts`
- Create: `backend/src/modules/accounting/public-finance/export-image.ts`
- Create: `backend/src/modules/accounting/public-finance/route.ts`
- Modify: `backend/src/app.ts` (mount the new public route)
- Modify: `backend/src/modules/accounting/reports/route.ts` (add admin status/publish/revoke endpoints)

**Interfaces:**
- Consumes: `buildCashFlow` from `../reports/services/cash-flow.js` (returns `CashFlowData` with `.closingCash: string`), `buildTopCategories` from `../reports/services/category-breakdown.js` (Task 2), `renderPngFromHtml` from `../reports/export/browser.js` (Task 3), `parsePeriod`/`InvalidPeriodError` from `../reports/period.js`.
- Produces: `getPublicFinanceStatus(tenantId)`, `publishPublicFinance({tenantId, actorAuthUserId})`, `revokePublicFinance({tenantId, actorAuthUserId})`, `buildPublicFinanceReport({tenantId, period}): Promise<PublicFinanceReportResponse>`, `renderPublicFinanceImage(report: PublicFinanceReportResponse): Promise<Buffer>`, exported Hono app `publicFinanceRoute`.

- [ ] **Step 1: Types**

```ts
// backend/src/modules/accounting/public-finance/types.ts
import type { ReportPeriod } from '../reports/types.js';
import type { CategoryAmount } from '../reports/services/category-breakdown.js';

export interface PublicFinanceReportResponse {
  reportType: 'finance-transparency';
  mosque: {
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
  };
  period: ReportPeriod;
  publication: {
    publishedAt: string;
  };
  generatedAt: string;
  data: {
    cashPosition: string;
    topIncome: CategoryAmount[];
    topExpense: CategoryAmount[];
  };
}
```

- [ ] **Step 2: Service — status/publish/revoke (mirrors `public-pap/service.ts` minus fund)**

```ts
// backend/src/modules/accounting/public-finance/service.ts
import { and, eq, isNull } from 'drizzle-orm';
import { asSuperAdmin, withTenant } from '../../../db/client.js';
import { tenants, users } from '../../../db/schema/core.js';
import { publicFinanceReports } from '../../../db/schema/accounting.js';
import { mosqueProfiles } from '../../../db/schema/organization.js';
import { memClearPrefix, memGet, memSet } from '../../../lib/memory-cache.js';
import { buildCashFlow } from '../reports/services/cash-flow.js';
import { buildTopCategories } from '../reports/services/category-breakdown.js';
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

  const [tenantIdentity, profile, cashFlow, categories] = await Promise.all([
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
    },
  };
  memSet(cacheKey, response, CACHE_TTL_SEC);
  return response;
}
```

Note: check `buildCashFlow`'s actual parameter shape in `backend/src/modules/accounting/reports/services/cash-flow.ts` before wiring this up — it's called elsewhere as `buildCashFlow({ tenantId, period, comparePeriod? })` per `reports/route.ts`; omit `comparePeriod` here since it's optional.

- [ ] **Step 3: Image renderer**

```ts
// backend/src/modules/accounting/public-finance/export-image.ts
import { renderPngFromHtml } from '../reports/export/browser.js';
import type { PublicFinanceReportResponse } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function formatRupiah(amount: string): string {
  const n = Math.round(Number(amount));
  return `Rp${n.toLocaleString('id-ID')}`;
}

function categoryLine(cat: PublicFinanceReportResponse['data']['topIncome'][number] | undefined): string {
  if (!cat) return '<div class="cat-name">Belum ada data</div>';
  return `<div class="cat-name">${escapeHtml(cat.categoryName)}</div><div class="cat-amount">${formatRupiah(cat.amount)}</div>`;
}

export function renderPublicFinanceHtml(report: PublicFinanceReportResponse, publicUrl: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
  body { width: 1080px; height: 1350px; background: linear-gradient(180deg, #f8fbf9 0%, #eef4ef 100%); padding: 64px; color: #1a2e22; }
  .brand { display: flex; align-items: center; gap: 24px; margin-bottom: 48px; }
  .brand img { width: 88px; height: 88px; border-radius: 24px; object-fit: cover; }
  .brand-name { font-size: 40px; font-weight: 800; }
  .kicker { font-size: 22px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #0d9467; margin-bottom: 8px; }
  .period { font-size: 26px; color: #4b5f54; margin-top: 60px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 32px; padding: 40px 48px; margin-bottom: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .card-label { font-size: 24px; color: #5c6b62; font-weight: 600; margin-bottom: 12px; }
  .card-main { font-size: 56px; font-weight: 800; }
  .cat-name { font-size: 30px; font-weight: 700; }
  .cat-amount { font-size: 44px; font-weight: 800; margin-top: 6px; }
  .income .cat-amount { color: #0d9467; }
  .expense .cat-amount { color: #b3541e; }
  .footer { margin-top: 48px; font-size: 22px; color: #5c6b62; text-align: center; }
  .footer .url { font-weight: 700; color: #0d9467; }
</style></head>
<body>
  <div class="brand">
    ${report.mosque.logoUrl ? `<img src="${escapeHtml(report.mosque.logoUrl)}" />` : ''}
    <div>
      <div class="kicker">Transparansi Keuangan</div>
      <div class="brand-name">${escapeHtml(report.mosque.name)}</div>
    </div>
  </div>
  <div class="period">Periode: ${escapeHtml(report.period.label)}</div>
  <div class="card">
    <div class="card-label">Posisi Kas Saat Ini</div>
    <div class="card-main">${formatRupiah(report.data.cashPosition)}</div>
  </div>
  <div class="card income">
    <div class="card-label">Pemasukan Terbesar</div>
    ${categoryLine(report.data.topIncome[0])}
  </div>
  <div class="card expense">
    <div class="card-label">Pengeluaran Terbesar</div>
    ${categoryLine(report.data.topExpense[0])}
  </div>
  <div class="footer">Detail lengkap di<br/><span class="url">${escapeHtml(publicUrl)}</span></div>
</body></html>`;
}

export async function renderPublicFinanceImage(
  report: PublicFinanceReportResponse,
  publicUrl: string,
): Promise<Buffer> {
  const html = renderPublicFinanceHtml(report, publicUrl);
  return renderPngFromHtml(html, { width: 1080, height: 1350 });
}
```

- [ ] **Step 4: Public route**

```ts
// backend/src/modules/accounting/public-finance/route.ts
import { Hono } from 'hono';
import { tenantResolver, requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { rateLimit } from '../../../middleware/rate-limit.js';
import { InvalidPeriodError, parsePeriod } from '../reports/period.js';
import { buildPublicFinanceReport, PublicFinanceUnavailableError } from './service.js';
import { renderPublicFinanceImage } from './export-image.js';

function defaultPeriodQuery() {
  const now = new Date();
  return { month: String(now.getUTCMonth() + 1), year: String(now.getUTCFullYear()) };
}

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { 'Cache-Control': 'no-store', ...extra };
}

export const publicFinanceRoute = new Hono<{ Variables: TenantVars }>()
  .use('*', tenantResolver())
  .use('*', requireTenant())
  .get('/', async (c, next) => {
    return rateLimit(c.req.query('format') === 'image' ? 'publicPdf' : 'public')(c, next);
  }, async (c) => {
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'image') {
      return c.json({ error: 'invalid_format' }, 400, noStoreHeaders());
    }

    let period;
    try {
      period = parsePeriod({
        month: c.req.query('month') ?? defaultPeriodQuery().month,
        year: c.req.query('year') ?? defaultPeriodQuery().year,
        startDate: c.req.query('startDate'),
        endDate: c.req.query('endDate'),
      });
    } catch (err) {
      if (err instanceof InvalidPeriodError) {
        return c.json({ error: 'invalid_period', detail: err.message }, 400, noStoreHeaders());
      }
      throw err;
    }

    try {
      const report = await buildPublicFinanceReport({ tenantId: c.get('tenantId')!, period });
      if (format === 'image') {
        const origin = new URL(c.req.url).origin.replace(/^https?:\/\/[^.]+\.onrender\.com/, 'https://mizanmu.pages.dev');
        const tenantSlug = c.req.query('tenant_slug');
        const publicUrl = `https://mizanmu.pages.dev/transparansi/${tenantSlug ?? ''}`.replace(/\/$/, '');
        const png = await renderPublicFinanceImage(report, publicUrl);
        return c.body(png as never, {
          headers: noStoreHeaders({
            'Content-Type': 'image/png',
            'Content-Disposition': `inline; filename="keuangan-${period.label}.png"`,
          }),
        });
      }
      return c.json(report, 200, noStoreHeaders());
    } catch (err) {
      if (err instanceof PublicFinanceUnavailableError) {
        return c.json({ error: 'public_report_unavailable' }, 404, noStoreHeaders());
      }
      throw err;
    }
  });
```

Note: re-check `rateLimit`'s accepted bucket names in `backend/src/middleware/rate-limit.ts` before wiring — the sketch above reuses the existing `'public'` / `'publicPdf'` buckets from `public-pap/route.ts`; if image generation should get its own bucket, add one there following that file's existing pattern instead of reusing `'publicPdf'`.

The `origin` line above is unused dead logic — drop it; `publicUrl` only needs the tenant slug. Simplify to:

```ts
const tenantSlug = c.req.query('tenant_slug') ?? '';
const publicUrl = `https://mizanmu.pages.dev/transparansi/${tenantSlug}`;
```

- [ ] **Step 5: Mount the public route in `app.ts`**

In `backend/src/app.ts`, next to the existing `import { publicPapRoute } ...` (line 19) and `app.route('/api/public/pap', publicPapRoute);` (line 108):

```ts
import { publicFinanceRoute } from './modules/accounting/public-finance/route.js';
// ...
app.route('/api/public/keuangan', publicFinanceRoute);
```

- [ ] **Step 6: Add admin endpoints to `reports/route.ts`**

In `backend/src/modules/accounting/reports/route.ts`, add the import:

```ts
import {
  getPublicFinanceStatus,
  publishPublicFinance,
  revokePublicFinance,
} from '../public-finance/service.js';
```

Add these three routes to the `reportsRoute` chain, right after the existing `/public-pap/revoke` block (after line 209, before the `/posisi-keuangan` block):

```ts
  .get('/public-finance', requirePermission('reports.read'), async (c) => {
    const status = await getPublicFinanceStatus(c.get('tenantId')!);
    return c.json({ data: status });
  })

  .post('/public-finance/publish', requirePermission('reports.publish'), async (c) => {
    const row = await publishPublicFinance({
      tenantId: c.get('tenantId')!,
      actorAuthUserId: c.get('user')!.id,
    });
    return c.json({ data: row });
  })

  .post('/public-finance/revoke', requirePermission('reports.publish'), async (c) => {
    const row = await revokePublicFinance({
      tenantId: c.get('tenantId')!,
      actorAuthUserId: c.get('user')!.id,
    });
    return c.json({ data: row });
  })
```

- [ ] **Step 7: Typecheck**

Run: `cd backend && pnpm typecheck`
Expected: no errors. Fix any field/type mismatches against the actual `cash-flow.ts` / `mosqueProfiles` / `middleware/rate-limit.ts` signatures found while wiring this up (those are read, not guessed, during implementation).

- [ ] **Step 8: Manual endpoint check**

Run the backend dev server (`pnpm --filter @masjidmu/backend dev`) and:
- `curl -s localhost:3001/api/v1/reports/public-finance` (with a valid session cookie, or via the browser once logged in) → `{"data": null}` before publishing.
- After publishing via the admin UI (Task 6) or a direct `POST`, `curl -s "localhost:3001/api/public/keuangan?tenant_slug=pca-ponjong"` → JSON with `cashPosition`/`topIncome`/`topExpense`.
- `curl -s "localhost:3001/api/public/keuangan?tenant_slug=pca-ponjong&format=image" -o /tmp/test.png` → valid PNG file (`file /tmp/test.png` reports PNG image data, 1080 x 1350).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/accounting/public-finance backend/src/app.ts backend/src/modules/accounting/reports/route.ts
git commit -m "feat(reports): add public-finance module (status/publish/revoke, public JSON+PNG endpoint)"
```

---

### Task 5: Frontend public page + router

**Files:**
- Create: `frontend/src/features/public-finance/PublicFinanceView.vue`
- Modify: `frontend/src/router/index.ts`

**Interfaces:**
- Consumes: `GET /api/public/keuangan` JSON shape from Task 4 Step 1 (`PublicFinanceReportResponse`).

- [ ] **Step 1: Add router entries**

In `frontend/src/router/index.ts`, right after the existing `/transparansi/:tenantSlug/pap` block (after line 22):

```ts
  {
    path: '/transparansi',
    name: 'public-finance-transparency',
    component: () => import('@/features/public-finance/PublicFinanceView.vue'),
    meta: { public: true },
  },
  {
    path: '/transparansi/:tenantSlug',
    name: 'public-finance-transparency-slug',
    component: () => import('@/features/public-finance/PublicFinanceView.vue'),
    meta: { public: true },
  },
```

- [ ] **Step 2: Build the public page**

Mirror `frontend/src/features/public-pap/PublicPapView.vue` structure exactly (same header/period-picker/skeleton/unavailable-state pattern, same `tenantSlugForDev()`/`validTenantSlug()` helpers copied verbatim), but:
- Fetch `/api/public/keuangan` instead of `/api/public/pap`.
- Replace the 4-tile Dana PAP summary + mutations table with 3 tiles (Posisi Kas Saat Ini, Pemasukan Terbesar, Pengeluaran Terbesar) plus two small ranked lists (top categories beyond #1, up to 5 each) instead of a movements table.
- Replace the "Unduh PDF" button with "Unduh Gambar" pointing at `format=image`.

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Download, ImageDown, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-vue-next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import AppSelect from '@/shared/ui/AppSelect.vue';
import Button from '@/shared/ui/Button.vue';
import DatePicker from '@/shared/ui/DatePicker.vue';
import MoneyText from '@/shared/ui/MoneyText.vue';
import { getTenantSlug } from '@/shared/api/client';

interface CategoryAmount {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  amount: string;
}

interface PublicFinanceReport {
  reportType: 'finance-transparency';
  mosque: { name: string; shortName: string | null; logoUrl: string | null; bannerUrl: string | null };
  period: { startDate: string; endDate: string; label: string };
  publication: { publishedAt: string };
  generatedAt: string;
  data: { cashPosition: string; topIncome: CategoryAmount[]; topExpense: CategoryAmount[] };
}

const route = useRoute();
const now = new Date();
const loading = ref(false);
const unavailable = ref(false);
const error = ref<string | null>(null);
const report = ref<PublicFinanceReport | null>(null);
const periodMode = ref<'monthly' | 'custom'>('monthly');
const month = ref(now.getMonth() + 1);
const year = ref(now.getFullYear());
const dateFrom = ref<string | null>(null);
const dateTo = ref<string | null>(null);

const periodModeOptions = [
  { value: 'monthly', label: 'Per Bulan' },
  { value: 'custom', label: 'Custom' },
];

const monthOptions = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2000, i, 1).toLocaleDateString('id-ID', { month: 'long' }),
  })),
);
const yearOptions = computed(() => {
  const y = now.getFullYear();
  return Array.from({ length: 6 }, (_, i) => ({ value: String(y - i), label: String(y - i) }));
});
const monthStr = computed({ get: () => String(month.value), set: (v: string) => { month.value = Number(v); } });
const yearStr = computed({ get: () => String(year.value), set: (v: string) => { year.value = Number(v); } });

function validTenantSlug(slug: unknown): string | null {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return !['api', 'admin', 'app', 'www'].includes(slug) ? slug : null;
}

function tenantSlugForDev(): string | null {
  const routeSlug = validTenantSlug(route.params.tenantSlug);
  if (routeSlug) return routeSlug;
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev')) {
    return validTenantSlug(getTenantSlug());
  }
  return null;
}

function buildPublicUrl(format?: 'image'): string {
  const params = new URLSearchParams();
  if (periodMode.value === 'custom') {
    if (dateFrom.value) params.set('startDate', dateFrom.value);
    if (dateTo.value) params.set('endDate', dateTo.value);
  } else {
    params.set('month', String(month.value));
    params.set('year', String(year.value));
  }
  const tenantSlug = tenantSlugForDev();
  if (tenantSlug) params.set('tenant_slug', tenantSlug);
  if (format) params.set('format', format);
  return `/api/public/keuangan?${params.toString()}`;
}

const imageUrl = computed(() => buildPublicUrl('image'));

async function load(): Promise<void> {
  if (periodMode.value === 'custom' && (!dateFrom.value || !dateTo.value)) return;
  loading.value = true;
  error.value = null;
  unavailable.value = false;
  try {
    const res = await fetch(buildPublicUrl(), { credentials: 'omit', headers: { Accept: 'application/json' } });
    const parsed = await res.json().catch(() => null) as PublicFinanceReport | { error?: string; detail?: string } | null;
    if (res.status === 404) {
      unavailable.value = true;
      report.value = null;
      return;
    }
    if (!res.ok) {
      error.value = (parsed as { detail?: string; error?: string } | null)?.detail
        ?? (parsed as { error?: string } | null)?.error
        ?? 'Gagal memuat laporan publik';
      report.value = null;
      return;
    }
    report.value = parsed as PublicFinanceReport;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Gagal memuat laporan publik';
    report.value = null;
  } finally {
    loading.value = false;
  }
}

watch([periodMode, month, year, dateFrom, dateTo], () => { void load(); });
onMounted(() => { void load(); });
</script>

<template>
  <main class="min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32rem),linear-gradient(180deg,#f8fbf9_0%,#eef4ef_100%)] px-4 py-6 text-foreground sm:px-6 lg:px-8">
    <div class="mx-auto max-w-4xl space-y-5">
      <header class="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div v-if="report?.mosque.bannerUrl" class="h-32 bg-cover bg-center" :style="{ backgroundImage: `url(${report.mosque.bannerUrl})` }" />
        <div class="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div class="flex items-center gap-4">
            <img v-if="report?.mosque.logoUrl" :src="report.mosque.logoUrl" alt="" class="size-14 rounded-2xl border bg-background object-cover" />
            <span v-else class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck class="size-7" /></span>
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">Transparansi Keuangan</p>
              <h1 class="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{{ report?.mosque.name || 'Laporan Keuangan' }}</h1>
              <p class="mt-1 text-sm text-muted-foreground">{{ report?.period.label || 'Ringkasan publik keuangan lembaga' }}</p>
            </div>
          </div>
          <a v-if="report" :href="imageUrl" target="_blank" rel="noopener">
            <Button variant="secondary"><ImageDown class="h-4 w-4" /> Unduh Gambar</Button>
          </a>
        </div>
      </header>

      <Card>
        <CardContent class="flex flex-wrap items-center gap-2.5 px-4 py-3">
          <span class="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex"><Download class="size-4" /> Periode</span>
          <div class="w-full max-w-[120px]"><AppSelect v-model="periodMode" :options="periodModeOptions" /></div>
          <template v-if="periodMode === 'monthly'">
            <div class="w-full max-w-[150px]"><AppSelect v-model="monthStr" :options="monthOptions" /></div>
            <div class="w-full max-w-[100px]"><AppSelect v-model="yearStr" :options="yearOptions" /></div>
          </template>
          <template v-else>
            <DatePicker v-model="dateFrom" placeholder="Dari tgl" />
            <span class="text-xs text-muted-foreground">s/d</span>
            <DatePicker v-model="dateTo" placeholder="Sampai tgl" />
          </template>
        </CardContent>
      </Card>

      <Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>

      <Card v-if="unavailable && !loading">
        <CardContent class="flex flex-col items-center gap-3 py-16 text-center">
          <span class="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"><Wallet class="size-6" /></span>
          <div>
            <p class="text-base font-semibold text-foreground">Laporan belum dipublikasikan</p>
            <p class="mt-1 max-w-md text-sm text-muted-foreground">Pengelola belum mengaktifkan ringkasan keuangan publik untuk lembaga ini.</p>
          </div>
        </CardContent>
      </Card>

      <template v-else-if="loading">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3"><Skeleton v-for="i in 3" :key="i" class="h-24 rounded-2xl" /></div>
        <Skeleton class="h-64 rounded-2xl" />
      </template>

      <template v-else-if="report">
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Ringkasan Keuangan">
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Wallet class="size-3.5 text-emerald-700" /> Posisi Kas Saat Ini</p>
            <MoneyText :value="report.data.cashPosition" tone="none" class="mt-1 block text-2xl font-extrabold" />
          </div>
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingUp class="size-3.5 text-emerald-700" /> Pemasukan Terbesar</p>
            <template v-if="report.data.topIncome[0]">
              <p class="mt-1 truncate text-sm font-semibold text-foreground">{{ report.data.topIncome[0].categoryName }}</p>
              <MoneyText :value="report.data.topIncome[0].amount" tone="income" class="block text-xl font-extrabold" />
            </template>
            <p v-else class="mt-1 text-sm text-muted-foreground">Belum ada data</p>
          </div>
          <div class="rounded-2xl border bg-card p-4 shadow-sm">
            <p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingDown class="size-3.5 text-amber-700" /> Pengeluaran Terbesar</p>
            <template v-if="report.data.topExpense[0]">
              <p class="mt-1 truncate text-sm font-semibold text-foreground">{{ report.data.topExpense[0].categoryName }}</p>
              <MoneyText :value="report.data.topExpense[0].amount" tone="expense" class="block text-xl font-extrabold" />
            </template>
            <p v-else class="mt-1 text-sm text-muted-foreground">Belum ada data</p>
          </div>
        </section>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardContent class="space-y-2 p-4">
              <h2 class="text-sm font-bold text-foreground">Kategori Pemasukan</h2>
              <div v-for="c in report.data.topIncome" :key="c.categoryId" class="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span class="text-foreground">{{ c.categoryName }}</span>
                <MoneyText :value="c.amount" tone="income" />
              </div>
              <p v-if="!report.data.topIncome.length" class="py-4 text-center text-xs text-muted-foreground">Belum ada data</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="space-y-2 p-4">
              <h2 class="text-sm font-bold text-foreground">Kategori Pengeluaran</h2>
              <div v-for="c in report.data.topExpense" :key="c.categoryId" class="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span class="text-foreground">{{ c.categoryName }}</span>
                <MoneyText :value="c.amount" tone="expense" />
              </div>
              <p v-if="!report.data.topExpense.length" class="py-4 text-center text-xs text-muted-foreground">Belum ada data</p>
            </CardContent>
          </Card>
        </div>

        <p class="rounded-2xl border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Detail internal seperti nomor bukti, nama akun, dan catatan audit sengaja tidak dipublikasikan untuk menjaga privasi. Angka berasal dari transaksi yang sudah diposting.
        </p>
      </template>
    </div>
  </main>
</template>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/public-finance frontend/src/router/index.ts
git commit -m "feat(reports): add public finance transparency page + routes"
```

---

### Task 6: Admin card in `ReportsView.vue` + period-guard bug fix

**Files:**
- Modify: `frontend/src/features/reports/ReportsView.vue`

**Interfaces:**
- Consumes: `/api/v1/reports/public-finance` (GET/POST publish/POST revoke) from Task 4 Step 6.

- [ ] **Step 1: Fix the "month must be 1..12" bug**

At the top of `load()` (line 172-177), add the same guard `PublicPapView.vue` already has:

```ts
async function load(): Promise<void> {
  if (periodMode.value === 'custom' && (!dateFrom.value || !dateTo.value)) {
    data.value = null;
    error.value = null;
    return;
  }
  if (reportType.value === 'buku-dana' && !fundId.value) {
    data.value = null;
    error.value = 'Pilih dana terlebih dahulu untuk Buku Dana';
    return;
  }
  ...
```

(Keeps `error.value = null` rather than showing a message — an empty date field is a normal mid-typing state, not an error, matching how `PublicPapView.vue` handles it silently.)

- [ ] **Step 2: Add state + status loader for the new card**

Near the existing `publicPapFundId`/`publicPapStatus`/... refs (lines 86-92), add:

```ts
const publicFinanceStatus = ref<PublicFinanceStatus | null>(null);
const publicFinanceLoading = ref(false);
const publicFinanceSaving = ref(false);
const publicFinanceError = ref<string | null>(null);
const publishFinanceConfirmOpen = ref(false);
const revokeFinanceConfirmOpen = ref(false);
```

Near the `PublicPapStatus` interface (line 100), add:

```ts
interface PublicFinanceStatus {
  isPublished: boolean;
  publishedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}
```

Near `publicPapUrl` computed (line 252), add:

```ts
const publicFinanceUrl = computed(() => {
  const slug = getTenantSlug();
  return slug ? `https://mizanmu.pages.dev/transparansi/${slug}` : 'https://mizanmu.pages.dev/transparansi';
});
```

Near `loadPublicPapStatus`/`publishPublicPap`/`revokePublicPap` (lines 257-306), add the equivalents:

```ts
async function loadPublicFinanceStatus(): Promise<void> {
  if (!canPublishReports.value) return;
  publicFinanceLoading.value = true;
  publicFinanceError.value = null;
  try {
    const res = await api.get<{ data: PublicFinanceStatus | null }>('/api/v1/reports/public-finance');
    publicFinanceStatus.value = res.data;
  } catch (err) {
    publicFinanceError.value = (err as Error).message;
  } finally {
    publicFinanceLoading.value = false;
  }
}

async function publishPublicFinance(): Promise<void> {
  publicFinanceSaving.value = true;
  publicFinanceError.value = null;
  try {
    await api.post('/api/v1/reports/public-finance/publish', {});
    publishFinanceConfirmOpen.value = false;
    await loadPublicFinanceStatus();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string }; message?: string };
    publicFinanceError.value = e.body?.detail ?? e.body?.error ?? e.message ?? 'Gagal mempublikasikan laporan';
  } finally {
    publicFinanceSaving.value = false;
  }
}

async function revokePublicFinance(): Promise<void> {
  publicFinanceSaving.value = true;
  publicFinanceError.value = null;
  try {
    await api.post('/api/v1/reports/public-finance/revoke', {});
    revokeFinanceConfirmOpen.value = false;
    await loadPublicFinanceStatus();
  } catch (err) {
    const e = err as { body?: { error?: string; detail?: string }; message?: string };
    publicFinanceError.value = e.body?.detail ?? e.body?.error ?? e.message ?? 'Gagal mencabut publikasi';
  } finally {
    publicFinanceSaving.value = false;
  }
}

async function copyPublicFinanceUrl(): Promise<void> {
  await navigator.clipboard?.writeText(publicFinanceUrl.value);
}

function publicFinanceImageUrl(): string {
  const tenant = getTenantSlug();
  const params = new URLSearchParams({ format: 'image' });
  if (periodMode.value === 'custom') {
    if (dateFrom.value) params.set('startDate', dateFrom.value);
    if (dateTo.value) params.set('endDate', dateTo.value);
  } else {
    params.set('month', String(month.value));
    params.set('year', String(year.value));
  }
  if (tenant) params.set('tenant_slug', tenant);
  return `/api/public/keuangan?${params.toString()}`;
}
```

Add `void loadPublicFinanceStatus();` next to the existing `await loadPublicPapStatus();` call inside `bootReports()` (line 354) — run both in parallel: replace that single line with:

```ts
  await Promise.all([loadPublicPapStatus(), loadPublicFinanceStatus()]);
```

- [ ] **Step 3: Add the card to the template**

Right after the existing `</Card>` that closes the "Transparansi Dana PAP" card (after line 492), insert:

```html
    <Card v-if="canPublishReports">
      <CardContent class="space-y-3 px-4 py-4">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-sm font-semibold text-foreground">Transparansi Keuangan Umum</p>
            <p class="mt-1 max-w-2xl text-xs text-muted-foreground">
              Publikasikan ringkasan posisi kas dan kategori pemasukan/pengeluaran terbesar untuk jamaah — untuk seluruh lembaga, tidak terikat 1 dana. Cocok untuk lembaga yang tidak memakai Dana PSAK 109.
            </p>
          </div>
          <span
            class="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="publicFinanceStatus?.isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'"
          >
            {{ publicFinanceStatus?.isPublished ? 'Dipublikasikan' : 'Belum publik' }}
          </span>
        </div>

        <Alert v-if="publicFinanceError" variant="destructive">
          <AlertDescription>{{ publicFinanceError }}</AlertDescription>
        </Alert>

        <div class="flex flex-wrap gap-2">
          <Button
            v-if="!publicFinanceStatus?.isPublished"
            :disabled="publicFinanceSaving"
            :loading="publicFinanceSaving"
            @click="publishFinanceConfirmOpen = true"
          >
            Publikasikan
          </Button>
          <Button
            v-if="publicFinanceStatus?.isPublished"
            variant="secondary"
            :disabled="publicFinanceSaving"
            @click="revokeFinanceConfirmOpen = true"
          >
            Cabut
          </Button>
          <a v-if="publicFinanceStatus?.isPublished" :href="publicFinanceImageUrl()" target="_blank" rel="noopener">
            <Button variant="secondary"><Download class="h-3.5 w-3.5" /> Unduh Gambar</Button>
          </a>
        </div>

        <div v-if="publicFinanceStatus?.isPublished" class="flex flex-col gap-2 rounded-xl border bg-muted/30 px-3 py-3 text-xs sm:flex-row sm:items-center">
          <div class="min-w-0 flex-1">
            <p class="truncate text-muted-foreground">{{ publicFinanceUrl }}</p>
          </div>
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" @click="copyPublicFinanceUrl"><Copy class="h-3.5 w-3.5" /> Salin</Button>
            <a :href="publicFinanceUrl" target="_blank" rel="noopener">
              <Button variant="secondary" size="sm"><ExternalLink class="h-3.5 w-3.5" /> Buka</Button>
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
```

- [ ] **Step 4: Add the two confirm dialogs**

Find where `<ConfirmDialog>` is used for `publishConfirmOpen`/`revokeConfirmOpen` (search the file for `ConfirmDialog` — it's used near the end of the template for the Dana PAP publish/revoke actions) and add matching ones bound to `publishFinanceConfirmOpen`/`revokeFinanceConfirmOpen`, calling `publishPublicFinance`/`revokePublicFinance`, with copy like "Publikasikan ringkasan keuangan umum untuk jamaah?" / "Cabut publikasi ringkasan keuangan umum?" — copy the exact prop names/structure from the existing Dana PAP dialogs so behavior (loading state, confirm/cancel labels) matches.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/reports/ReportsView.vue
git commit -m "fix(reports): add Transparansi Keuangan Umum admin card; guard custom period fetch"
```

---

### Task 7: Changelog entry

**Files:**
- Modify: `frontend/src/features/changelog/ChangelogView.vue`

- [ ] **Step 1: Add an entry**

Find the existing entry with title `'Transparansi publik Dana PAP'` (search the file) and add a new entry above it (most-recent-first, matching existing order) following the exact same object shape (date, title, description fields — copy the neighboring entry's structure), titled `'Transparansi Keuangan Umum'`, description along the lines of: "Publikasikan ringkasan posisi kas dan kategori pemasukan/pengeluaran terbesar untuk seluruh lembaga (tanpa perlu Dana) — bisa diunduh sebagai gambar untuk dibagikan ke WhatsApp."

- [ ] **Step 2: Commit**

```bash
git add frontend/src/features/changelog/ChangelogView.vue
git commit -m "docs(changelog): announce Transparansi Keuangan Umum"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + build both packages**

Run: `cd backend && pnpm typecheck && pnpm build`
Run: `cd frontend && pnpm typecheck && pnpm build`
Expected: both exit 0.

- [ ] **Step 2: Start both dev servers and open the app**

Start `pnpm --filter @masjidmu/backend dev` and `pnpm --filter @masjidmu/frontend dev`, log in as PCA Ponjong admin, go to Laporan Keuangan.

- [ ] **Step 3: Verify the bug fix**

Switch period mode to "Custom" without picking dates. Expected: no red error banner appears (previously showed "month must be 1..12").

- [ ] **Step 4: Verify the new card end-to-end**

Click "Publikasikan" on the new "Transparansi Keuangan Umum" card, confirm the status badge flips to "Dipublikasikan" and a link appears. Click "Buka" — the public page loads with real PCA Ponjong figures. Click "Unduh Gambar" both from the admin card and from the public page — confirm a PNG downloads and visually contains the mosque name, the three figures, and the printed URL, legible at typical WhatsApp thumbnail size.

- [ ] **Step 5: Verify Dana PAP is untouched**

Confirm the existing "Transparansi Dana PAP" card still renders and behaves exactly as before (still shows "Belum ada dana" for PCA Ponjong, unchanged) — the refactor in Task 3 must not have altered its behavior.

- [ ] **Step 6: Revoke and confirm the public page goes back to "belum dipublikasikan"**

Click "Cabut" on the new card, reload the public page — expected: "Laporan belum dipublikasikan" state.
