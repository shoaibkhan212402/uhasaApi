export type WorkshopCategory = 'AML / Cybersecurity / Securities Innovation' | 'Other Topics';

export interface CalendarWorkshop {
  title: string;
  category: WorkshopCategory;
  cpd_hours: number;
  start_date: string;
  end_date: string;
}

const TIME_SLOT = '3:00 PM - 7:00 PM (Dubai)';

export const JULY_2026_WORKSHOPS: CalendarWorkshop[] = [
  {
    title: 'Robo-Advisors and Automated Wealth Management',
    category: 'Other Topics',
    cpd_hours: 10,
    start_date: '2026-07-01',
    end_date: '2026-07-02',
  },
  {
    title: 'Digital Awareness',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-07-07',
    end_date: '2026-07-07',
  },
  {
    title: 'Hedging Strategies',
    category: 'Other Topics',
    cpd_hours: 10,
    start_date: '2026-07-08',
    end_date: '2026-07-09',
  },
  {
    title: 'KYC, AML and Anti-Terrorist Financing',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-07-14',
    end_date: '2026-07-14',
  },
  {
    title: 'Stock Valuation',
    category: 'Other Topics',
    cpd_hours: 5,
    start_date: '2026-07-16',
    end_date: '2026-07-16',
  },
  {
    title: 'Role of the Money Laundering Reporting Officer',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-07-21',
    end_date: '2026-07-21',
  },
  {
    title: 'Anti–Money Laundering for Relationship Managers & Frontliners',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-07-23',
    end_date: '2026-07-23',
  },
  {
    title: 'Enforcement: Administrative Sanctions and Criminal Prosecution',
    category: 'Other Topics',
    cpd_hours: 15,
    start_date: '2026-07-28',
    end_date: '2026-07-30',
  },
];

export const AUGUST_2026_WORKSHOPS: CalendarWorkshop[] = [
  {
    title: 'Sustainable Finance',
    category: 'Other Topics',
    cpd_hours: 5,
    start_date: '2026-08-04',
    end_date: '2026-08-04',
  },
  {
    title: 'End-to-End Customer Due Diligence (CDD/EDD)',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-08-06',
    end_date: '2026-08-06',
  },
  {
    title: 'Credit Risk Analysis & Modeling',
    category: 'Other Topics',
    cpd_hours: 10,
    start_date: '2026-08-12',
    end_date: '2026-08-13',
  },
  {
    title: 'The UAE AML Reform- Federal Decree- Law 10 of 2025: Key Changes, Compliance Obligations and Implications for 2026 & Beyond',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-08-18',
    end_date: '2026-08-18',
  },
  {
    title: 'Operational Risk (CISI)',
    category: 'Other Topics',
    cpd_hours: 15,
    start_date: '2026-08-25',
    end_date: '2026-08-27',
  },
];

export const SEPTEMBER_2026_WORKSHOPS: CalendarWorkshop[] = [
  {
    title: 'Combating Financial Crimes(CISI)',
    category: 'Other Topics',
    cpd_hours: 15,
    start_date: '2026-09-01',
    end_date: '2026-09-03',
  },
  {
    title: 'Simulating Real Financial Crimes: Case-Based Training',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-09-08',
    end_date: '2026-09-08',
  },
  {
    title: 'Tokenization of Assets and Digital Securities',
    category: 'Other Topics',
    cpd_hours: 10,
    start_date: '2026-09-09',
    end_date: '2026-09-10',
  },
  {
    title: 'Managing Cyber Security',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-09-15',
    end_date: '2026-09-15',
  },
  {
    title: 'Board awareness on financial & cyber crimes',
    category: 'AML / Cybersecurity / Securities Innovation',
    cpd_hours: 5,
    start_date: '2026-09-17',
    end_date: '2026-09-17',
  },
  {
    title: 'Risk in Financial Services (CISI)',
    category: 'Other Topics',
    cpd_hours: 15,
    start_date: '2026-09-22',
    end_date: '2026-09-24',
  },
  {
    title: 'Fraud and Ethics',
    category: 'Other Topics',
    cpd_hours: 5,
    start_date: '2026-09-30',
    end_date: '2026-09-30',
  },
];

export const CALENDAR_SYNC_RANGES = {
  july: { from: '2026-07-01', to: '2026-07-31', workshops: JULY_2026_WORKSHOPS },
  august: { from: '2026-08-01', to: '2026-08-31', workshops: AUGUST_2026_WORKSHOPS },
  september: { from: '2026-09-01', to: '2026-09-30', workshops: SEPTEMBER_2026_WORKSHOPS },
} as const;

export { TIME_SLOT };
