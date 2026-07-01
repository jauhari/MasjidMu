/**
 * Default funds (Dana) per edition.
 *
 *  - Every tenant gets the single 'umum' fund (general operating fund). The
 *    masjid / generic non-profit (ISAK 35) edition only ever uses this one,
 *    so existing behaviour is unchanged and `fundId` can stay null.
 *
 *  - The ZakatMu edition (Organisasi Pengelola Zakat) additionally seeds the
 *    four PSAK 109 funds. Zakat and wakaf are syariah-restricted in use.
 *
 * Seeded analogously to the chart of accounts: portable across tenants, no
 * explicit IDs in source, idempotent by (tenant_id, code).
 */
import type { fundTypeEnum } from '../../../db/schema/accounting.js';

export type FundType = (typeof fundTypeEnum.enumValues)[number];

export interface DefaultFundSpec {
  code: string;
  name: string;
  fundType: FundType;
  isRestricted: boolean;
  isSystem?: boolean;
  description?: string;
  sortOrder: number;
}

/** Always seeded — the single general operating fund. */
export const GENERAL_FUND: DefaultFundSpec = {
  code: 'UMUM',
  name: 'Dana Umum / Operasional',
  fundType: 'umum',
  isRestricted: false,
  isSystem: true,
  sortOrder: 0,
};

/** PSAK 109 funds — seeded only for the ZakatMu (OPZ) edition. */
export const PSAK_109_DEFAULT_FUNDS: DefaultFundSpec[] = [
  {
    code: 'ZKT',
    name: 'Dana Zakat',
    fundType: 'zakat',
    isRestricted: true,
    isSystem: true,
    description: 'Disalurkan hanya kepada 8 asnaf (QS At-Taubah: 60).',
    sortOrder: 10,
  },
  {
    code: 'INF',
    name: 'Dana Infak / Sedekah',
    fundType: 'infaq_sedekah',
    isRestricted: false,
    isSystem: true,
    sortOrder: 20,
  },
  {
    code: 'AML',
    name: 'Dana Amil',
    fundType: 'amil',
    isRestricted: false,
    isSystem: true,
    description: 'Hak amil dari zakat (maks. 1/8) dan bagian infak/sedekah.',
    sortOrder: 30,
  },
  {
    code: 'NHL',
    name: 'Dana Non-halal',
    fundType: 'nonhalal',
    isRestricted: true,
    isSystem: true,
    description: 'Mis. bunga bank; hanya untuk kepentingan umum non-ibadah.',
    sortOrder: 40,
  },
];

/** PSAK 112 wakaf fund — seeded for editions that manage wakaf (nazhir). */
export const PSAK_112_WAKAF_FUND: DefaultFundSpec = {
  code: 'WKF',
  name: 'Dana Wakaf',
  fundType: 'wakaf',
  isRestricted: true,
  isSystem: true,
  description: 'Pokok wakaf tidak boleh berkurang; hanya manfaat yang disalurkan.',
  sortOrder: 50,
};
