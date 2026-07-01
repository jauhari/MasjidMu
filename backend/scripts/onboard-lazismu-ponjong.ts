/**
 * One-off onboarding script: create tenant "LazisMu Ponjong" (edisi LAZ),
 * seed default COA + PSAK 109 dana, then add 7 custom program/campaign dana
 * derived from the historical spreadsheet (SIFAT column analysis).
 *
 * Mirrors what POST /api/v1/tenants + POST /api/v1/funds do — just invoked
 * directly since there's no HTTP session available in this context.
 *
 * Idempotent: safe to re-run (skips if tenant/dana already exist).
 */
import { asSuperAdmin, withTenant } from '../src/db/client.js';
import { tenants } from '../src/db/schema/core.js';
import { funds } from '../src/db/schema/accounting.js';
import { eq, and, isNull } from 'drizzle-orm';
import { seedDefaultChart } from '../src/modules/accounting/accounts/service.js';
import { fundSeedOptionsForEdition, seedFunds } from '../src/modules/accounting/funds/service.js';

const SLUG = 'lazismu-ponjong';
const NAME = 'LazisMu Ponjong';

interface CustomFund {
  code: string;
  name: string;
  description: string;
}

const CUSTOM_FUNDS: CustomFund[] = [
  { code: 'PRG-AMBULANS', name: 'Program Ambulans', description: 'Operasional & pengadaan ambulans (dari SIFAT: AMBULANS)' },
  { code: 'PRG-SUMATRA', name: 'Peduli Aceh-Sumatra', description: 'Bantuan bencana Aceh-Sumatra (dari SIFAT: SUMATRA)' },
  { code: 'PRG-DIANDRA', name: 'Peduli Diandra', description: 'Kampanye Peduli Diandra (dari SIFAT: Diandra)' },
  { code: 'PRG-REHAB', name: 'Rehab Kantor', description: 'Renovasi kantor LazisMu Ponjong (dari SIFAT: REHAP KANTOR)' },
  { code: 'PRG-TALUD', name: 'Program Talud', description: 'Proyek talud/penahan tanah (dari SIFAT: TALUD)' },
  { code: 'PRG-APRILLIA', name: 'Kasus Aprillia', description: 'Bantuan kasus Aprillia (dari SIFAT: APRILLIA)' },
  { code: 'DSKL', name: 'Dana Sosial Keagamaan Lainnya', description: 'Dana sosial keagamaan lain-lain (dari SIFAT: DKSL/DLSL)' },
];

async function main() {
  console.log('1. Cek/buat tenant...');
  const tenant = await asSuperAdmin(async (tx) => {
    const existing = await tx.select().from(tenants).where(eq(tenants.slug, SLUG));
    if (existing[0]) {
      console.log(`   • tenant "${SLUG}" sudah ada`);
      return existing[0];
    }
    const [t] = await tx
      .insert(tenants)
      .values({ slug: SLUG, name: NAME, edition: 'laz' })
      .returning();
    console.log(`   ✓ tenant "${SLUG}" dibuat (edisi: laz)`);
    return t!;
  });

  console.log('2. Seed bagan akun default (PSAK 45)...');
  const insertedAccounts = await seedDefaultChart(tenant.id);
  console.log(`   ✓ ${insertedAccounts} akun baru (0 = sudah ada semua)`);

  console.log('3. Seed dana PSAK 109 (Zakat/Infak-Sedekah/Amil/Non-halal + Umum)...');
  const fundOpts = fundSeedOptionsForEdition(tenant.edition);
  const insertedFunds = await withTenant(tenant.id, async (db) =>
    seedFunds(tenant.id, fundOpts ?? {}, db),
  );
  console.log(`   ✓ ${insertedFunds} dana PSAK 109 baru`);

  console.log('4. Buat dana program/kampanye kustom...');
  await withTenant(tenant.id, async (db) => {
    const existing = await db
      .select({ code: funds.code })
      .from(funds)
      .where(and(eq(funds.tenantId, tenant.id), isNull(funds.deletedAt)));
    const existingCodes = new Set(existing.map((f) => f.code));

    let inserted = 0;
    for (const [i, cf] of CUSTOM_FUNDS.entries()) {
      if (existingCodes.has(cf.code)) {
        console.log(`   • ${cf.code} sudah ada`);
        continue;
      }
      await db.insert(funds).values({
        tenantId: tenant.id,
        code: cf.code,
        name: cf.name,
        fundType: 'infaq_sedekah',
        isRestricted: true,
        description: cf.description,
        sortOrder: 100 + i,
      });
      console.log(`   ✓ ${cf.code} — ${cf.name}`);
      inserted++;
    }
    console.log(`   Total dana kustom baru: ${inserted}`);
  });

  console.log('\n✅ Onboarding selesai.');
  console.log(`   Tenant ID:   ${tenant.id}`);
  console.log(`   Slug:        ${SLUG}`);
  console.log(`   Login pakai akun super_admin yang ada, dengan tenant slug: ${SLUG}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Onboarding gagal:', e);
    process.exit(1);
  });
