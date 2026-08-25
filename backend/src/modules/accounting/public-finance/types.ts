import type { ReportPeriod } from '../reports/types.js';
import type { CategoryAmount } from '../reports/services/category-breakdown.js';
import type { MonthlyAmount } from '../reports/services/monthly-trend.js';

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
    monthlyTrend: MonthlyAmount[];
  };
}
