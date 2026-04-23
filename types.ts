export interface LedgerEntry {
  guid: string;
  date: string;
  voucher_type: string;
  voucher_number: string;
  invoice_number?: string;
  Ledger: string;
  amount: number;
  Group: string;
  TallyParent: string;
  TallyPrimary: string;
  narration?: string;
  party_name?: string;
  gstin?: string;
  opening_balance?: number;
  closing_balance?: number;
  is_accounting_voucher?: number;
  is_master_ledger?: number;
  // Index signature to allow for flexible CSV parsing
  [key: string]: any; 
}

// ── TDS Section Definitions (B2) ──────────────────────────────────────────────
export interface TDSSectionRate {
  label: string;
  rate: number; // percentage, e.g. 2
}

export interface TDSSectionDef {
  code: string;           // e.g. "194C"
  label: string;          // e.g. "Contractors"
  singleTxnLimit: number; // per-payment threshold (₹). 0 = no limit (always applicable)
  annualLimit: number;    // aggregate annual threshold (₹). 0 = no limit
  defaultRate: number;    // % e.g. 2
  rates: TDSSectionRate[];
}

// Mapping a TDS ledger to an Indian TDS section
export interface TDSSectionMapping {
  ledger: string;
  sectionCode: string; // maps to TDSSectionDef.code
}

// Full threshold configuration stored in AuditSettings
export interface TDSThresholdConfig {
  enabled: boolean;           // if false, threshold logic is skipped
  sectionMappings: TDSSectionMapping[];
}

// Voucher-level TDS status (B6 statuses)
export type TDSVoucherStatus =
  | 'deducted'          // TDS correctly deducted
  | 'short_deducted'    // TDS deducted but amount < 95% of expected
  | 'missed'            // TDS applicable but not deducted
  | 'below_threshold';  // Exempt: single txn + YTD both below limits

// Audit annotation for any voucher row (D2)
export interface AuditAnnotation {
  key: string;       // voucher_key or group_key
  note: string;
  updatedAt: string; // ISO date string
}

export interface AuditSettings {
  salesGstLedgers: string[];
  purchaseGstLedgers: string[];
  tdsTaxLedgers: string[];
  rcmTaxLedgers: string[];
  blockedCreditLedgers: string[];
  relatedParties: string[];
  gstLedgerSummary: string[];
  partyMatrixProfile: PartyMatrixProfile;
  tdsThresholdConfig: TDSThresholdConfig;
  tdsAnnotations: AuditAnnotation[];
}

export interface PartyMatrixProfile {
  selectedPrimaryGroup: string;
  tdsLedgers: string[];
  gstLedgers: string[];
  rcmLedgers: string[];
}

export interface VoucherGroup {
  voucher_number: string;
  date: string;
  voucher_type: string;
  entries: LedgerEntry[];
  totalAmount: number; // Sum of absolute values for context
}

export interface GSTRateResult {
  voucher_number: string;
  date: string;
  party_name: string;
  saleAmount: number;
  taxAmount: number;
  calculatedRate: number;
  taxLedgers: string[];
  salesLedgers: string[];
  status: 'Match' | 'Rate Issues' | 'GST Not Charged';
  statusDetail: string; // e.g., "Match 18%" or "Differs from std"
}

// Standard Indian TDS sections (used as default definitions in TDS module)
export const TDS_SECTION_DEFAULTS: TDSSectionDef[] = [
  { code: '194C',    label: 'Contractors',                  singleTxnLimit: 30000,   annualLimit: 100000,  defaultRate: 2,   rates: [{ label: 'Ind/HUF', rate: 1 }, { label: 'Others', rate: 2 }] },
  { code: '194J',    label: 'Professional/Technical Svcs',  singleTxnLimit: 30000,   annualLimit: 30000,   defaultRate: 10,  rates: [{ label: 'Technical', rate: 2 }, { label: 'Professional', rate: 10 }] },
  { code: '194H',    label: 'Commission / Brokerage',       singleTxnLimit: 15000,   annualLimit: 15000,   defaultRate: 5,   rates: [{ label: 'All', rate: 5 }] },
  { code: '194I(a)', label: 'Rent – Plant & Machinery',     singleTxnLimit: 240000,  annualLimit: 240000,  defaultRate: 2,   rates: [{ label: 'All', rate: 2 }] },
  { code: '194I(b)', label: 'Rent – Land/Building/Furn',   singleTxnLimit: 240000,  annualLimit: 240000,  defaultRate: 10,  rates: [{ label: 'All', rate: 10 }] },
  { code: '194A',    label: 'Interest (Non-bank)',          singleTxnLimit: 5000,    annualLimit: 5000,    defaultRate: 10,  rates: [{ label: 'All', rate: 10 }] },
  { code: '194Q',    label: 'Purchase of Goods (>50L)',     singleTxnLimit: 5000000, annualLimit: 5000000, defaultRate: 0.1, rates: [{ label: 'All', rate: 0.1 }] },
  { code: '194M',    label: 'Payment by Ind/HUF (>50L)',    singleTxnLimit: 5000000, annualLimit: 5000000, defaultRate: 5,   rates: [{ label: 'All', rate: 5 }] },
  { code: '194O',    label: 'E-commerce Operator',          singleTxnLimit: 500000,  annualLimit: 500000,  defaultRate: 1,   rates: [{ label: 'All', rate: 1 }] },
  { code: 'OTHER',   label: 'Other / Not Mapped',           singleTxnLimit: 0,       annualLimit: 0,       defaultRate: 0,   rates: [] },
];

export enum AnalysisType {
  DASHBOARD = 'DASHBOARD',
  TRIAL_BALANCE = 'TRIAL_BALANCE',
  DEBTOR_AGEING = 'DEBTOR_AGEING',
  CREDITOR_AGEING = 'CREDITOR_AGEING',
  VOUCHER_BOOK_VIEW = 'VOUCHER_BOOK_VIEW',
  LEDGER_VOUCHER_VIEW = 'LEDGER_VOUCHER_VIEW',
  GST_RATE = 'GST_RATE',
  SALES_REGISTER = 'SALES_REGISTER',
  PURCHASE_GST_REGISTER = 'PURCHASE_GST_REGISTER',
  GSTR2B_RECONCILIATION = 'GSTR2B_RECONCILIATION',
  TDS_ANALYSIS = 'TDS_ANALYSIS',
  RCM_ANALYSIS = 'RCM_ANALYSIS',
  GST_EXPENSE_ANALYSIS = 'GST_EXPENSE_ANALYSIS',
  PROFIT_LOSS_ANALYSIS = 'PROFIT_LOSS_ANALYSIS',
  CASH_FLOW_ANALYSIS = 'CASH_FLOW_ANALYSIS',
  VARIANCE_ANALYSIS = 'VARIANCE_ANALYSIS',
  EXCEPTION_DENSITY_HEATMAP = 'EXCEPTION_DENSITY_HEATMAP',
  BALANCE_SHEET_CLEANLINESS = 'BALANCE_SHEET_CLEANLINESS',
  TSF_COMPARISON = 'TSF_COMPARISON',
  LEDGER_ANALYTICS = 'LEDGER_ANALYTICS',
  PARTY_LEDGER_MATRIX = 'PARTY_LEDGER_MATRIX',
  RELATED_PARTY_ANALYSIS = 'RELATED_PARTY_ANALYSIS',
  AUDIT_CONFIG = 'AUDIT_CONFIG',
  GST_LEDGER_SUMMARY = 'GST_LEDGER_SUMMARY',
  ITC_3B_RECONCILIATION = 'ITC_3B_RECONCILIATION',
}
