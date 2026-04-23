import { LedgerEntry } from '../types';

export interface SqlLoadSummary {
  totalRows: number;
  uniqueVouchers: number;
  minDate: string;
  maxDate: string;
}

export interface TsfComparableRow {
  guid: string;
  date: string;
  voucher_type: string;
  voucher_number: string;
  invoice_number: string;
  reference_number: string;
  narration: string;
  party_name: string;
  gstin: string;
  ledger: string;
  amount: number;
  group_name: string;
  tally_parent: string;
  tally_primary: string;
  opening_balance: number;
  closing_balance: number;
  is_revenue: number;
  is_accounting_voucher: number;
  is_master_ledger: number;
}

export interface TsfModifiedRow {
  guid: string;
  amountDelta: number;
  currentRow: TsfComparableRow;
  newRow: TsfComparableRow;
  differences: Array<{
    field: string;
    label: string;
    currentValue: string | number;
    newValue: string | number;
  }>;
}

export interface TsfImpactRow {
  ledger?: string;
  voucherKey?: string;
  voucher_number?: string;
  date?: string;
  voucher_type?: string;
  currentAmount: number;
  newAmount: number;
  delta: number;
}

export interface TsfCompareSummary {
  currentRows: number;
  newRows: number;
  unchangedRows: number;
  addedRows: number;
  removedRows: number;
  modifiedRows: number;
  duplicateGuidsCurrent: number;
  duplicateGuidsNew: number;
  blankGuidRowsCurrent: number;
  blankGuidRowsNew: number;
  currentAmountTotal: number;
  newAmountTotal: number;
  addedAmount: number;
  removedAmount: number;
  modifiedAmountDelta: number;
  netAmountDelta: number;
  impactedLedgers: number;
  impactedVouchers: number;
}

export interface TsfComparePayload {
  strictMatchBy: string;
  comparedAt: string;
  summary: TsfCompareSummary;
  addedRows: TsfComparableRow[];
  removedRows: TsfComparableRow[];
  modifiedRows: TsfModifiedRow[];
  ledgerImpact: TsfImpactRow[];
  voucherImpact: TsfImpactRow[];
  duplicateGuids: {
    current: Array<{ guid: string; count: number }>;
    new: Array<{ guid: string; count: number }>;
  };
  blankGuidRows: {
    current: TsfComparableRow[];
    new: TsfComparableRow[];
  };
}

const jsonHeaders = { 'Content-Type': 'application/json' };
const NETWORK_HINT =
  'Cannot reach local API server. Start/restart using run_software.bat and open http://127.0.0.1:5173.';

const parseJsonSafe = async (response: Response): Promise<any> => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return { ok: false, error: await response.text() };
};

export const isSqlBackendAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/data/health');
    if (!response.ok) return false;
    const payload = await parseJsonSafe(response);
    return !!payload?.ok;
  } catch {
    return false;
  }
};

export const loadRowsIntoSql = async (rows: LedgerEntry[]): Promise<SqlLoadSummary> => {
  let response: Response;
  try {
    response = await fetch('/api/data/load', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rows }),
    });
  } catch {
    throw new Error(NETWORK_HINT);
  }
  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Failed to load dataset into SQL backend.');
  }
  return payload.summary as SqlLoadSummary;
};

export const fetchRowsFromSql = async (): Promise<LedgerEntry[]> => {
  let response: Response;
  try {
    response = await fetch('/api/data/rows');
  } catch {
    throw new Error(NETWORK_HINT);
  }
  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Failed to fetch rows from SQL backend.');
  }
  return Array.isArray(payload.rows) ? payload.rows : [];
};

export const fetchSqlSummary = async (): Promise<SqlLoadSummary> => {
  let response: Response;
  try {
    response = await fetch('/api/data/summary');
  } catch {
    throw new Error(NETWORK_HINT);
  }
  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Failed to fetch SQL dataset summary.');
  }
  return payload.summary as SqlLoadSummary;
};

export const clearSqlData = async (): Promise<void> => {
  try {
    await fetch('/api/data/clear', {
      method: 'POST',
      headers: jsonHeaders,
      body: '{}',
    });
  } catch {
    // Best-effort cleanup.
  }
};

export const importTallySourceFile = async (file: File): Promise<SqlLoadSummary> => {
  const buffer = await file.arrayBuffer();
  let response: Response;
  try {
    response = await fetch('/api/data/import-source', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-source-filename': encodeURIComponent(file.name || 'tally-source-file.tsf'),
      },
      body: buffer,
    });
  } catch {
    throw new Error(NETWORK_HINT);
  }
  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Failed to import Tally source file.');
  }
  return payload.summary as SqlLoadSummary;
};

export const exportTallySourceFile = async (): Promise<Blob> => {
  let response: Response;
  try {
    response = await fetch('/api/data/export-source');
  } catch {
    throw new Error(NETWORK_HINT);
  }
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    throw new Error(payload?.error || 'Failed to export Tally source file.');
  }
  return response.blob();
};

export const convertTallySourceFileToExcel = async (file: File): Promise<Blob> => {
  const buffer = await file.arrayBuffer();
  let response: Response;
  try {
    response = await fetch('/api/data/source-to-excel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-source-filename': encodeURIComponent(file.name || 'tally-source-file.tsf'),
      },
      body: buffer,
    });
  } catch {
    throw new Error(NETWORK_HINT);
  }
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    throw new Error(payload?.error || 'Failed to convert Tally source file to Excel.');
  }
  return response.blob();
};

export const compareTallySourceFile = async (file: File): Promise<TsfComparePayload> => {
  const buffer = await file.arrayBuffer();
  let response: Response;
  try {
    response = await fetch('/api/data/compare-source', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-source-filename': encodeURIComponent(file.name || 'compare-source-file.tsf'),
      },
      body: buffer,
    });
  } catch {
    throw new Error(NETWORK_HINT);
  }
  const payload = await parseJsonSafe(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Failed to compare Tally source file.');
  }
  return payload as TsfComparePayload;
};
