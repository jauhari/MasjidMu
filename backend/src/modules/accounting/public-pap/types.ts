import type { ReportPeriod } from '../reports/types.js';

export interface PublicPapMovement {
  sequence: number;
  date: string;
  direction: 'penerimaan' | 'penyaluran';
  label: 'Penerimaan Dana PAP' | 'Penyaluran Dana PAP';
  amount: string;
  runningBalance: string;
}

export interface PublicPapReportResponse {
  reportType: 'pap-transparency';
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
    fundName: string;
    openingBalance: string;
    totalPenerimaan: string;
    totalPenyaluran: string;
    surplusDeficit: string;
    closingBalance: string;
    movements: PublicPapMovement[];
  };
}
