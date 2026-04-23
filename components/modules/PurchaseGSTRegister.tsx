import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search, Info, CheckSquare, Square } from 'lucide-react';
import { LedgerEntry } from '../../types';
import { getUniqueLedgers } from '../../services/dataService';
import { isSqlBackendAvailable } from '../../services/sqlDataService';
import { fetchSqlModuleRows } from '../../services/sqlAnalyticsService';

type RegRow = {
  monthKey: string;
  date: string;
  invoice: string;
  issue: string;
  voucherType: string;
  party: string;
  partyGstinUin: string;
  tax: number;
  placeOfSupply: string;
  reverseCharge: 'Yes' | 'No';
  itcAvailability: string;
  type: string;
  purchaseExpenseLedgers: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  purchasePrimaryValue: number;
  expensePrimaryValue: number;
  fixedAssetPrimaryValue: number;
  hasPrimaryImpact: boolean;
  hitsSelectedGst: boolean;
  month3b: string;
  booksMonth: string;
};

type VoucherRecoRow = {
  date: string;
  invoice: string;
  voucherType: string;
  party: string;
  partyGstinUin: string;
  placeOfSupply: string;
  purchaseExpenseLedgers: string;
  purchasePrimaryValue: number;
  expensePrimaryValue: number;
  fixedAssetPrimaryValue: number;
  hasPrimaryImpact: boolean;
  hitsSelectedGst: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  tax: number;
  reverseCharge: 'Yes' | 'No';
  type: string;
  booksMonth: string;
};

type MonthlySummaryRow = {
  monthKey: string;
  monthLabel: string;
  voucherCount: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  tax: number;
};

interface PurchaseGSTRegisterProps {
  data: LedgerEntry[];
  externalSelectedLedgers?: string[];
  externalRcmLedgers?: string[];
  onLedgersUpdate?: (ledgers: string[]) => void;
}

const toDDMMYYYY = (value: string) => {
  if (!value) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const monthKeyFromDate = (d: string) => {
  const p = d.split('/');
  return p.length === 3 ? `${p[1]}/${p[2]}` : '';
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const booksMonthNameFromDate = (d: string) => {
  const p = d.split('/');
  if (p.length !== 3) return '';
  const mm = Number(p[1]);
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  return MONTH_NAMES[mm - 1];
};

const sanitizeInvoice = (s: string) => (s || '').replace(/\s+/g, '').trim();

const normalizeGstin = (s: string) => {
  const v = (s || '').trim().toUpperCase();
  return /^[0-9A-Z]{15}$/.test(v) ? v : '';
};

const isPurchaseExpenseFixedAssetByPrimary = (e: LedgerEntry) => {
  const primary = String(e.TallyPrimary || '').toLowerCase();
  return primary.includes('purchase') || primary.includes('expense') || primary.includes('fixed asset');
};

const isPurchaseByPrimary = (e: LedgerEntry) => String(e.TallyPrimary || '').toLowerCase().includes('purchase');
const isExpenseByPrimary = (e: LedgerEntry) => String(e.TallyPrimary || '').toLowerCase().includes('expense');
const isFixedAssetByPrimary = (e: LedgerEntry) => String(e.TallyPrimary || '').toLowerCase().includes('fixed asset');

const isAccountingVoucherEntry = (entry: LedgerEntry): boolean => {
  const raw = entry?.is_accounting_voucher;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const text = String(raw).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'n') return false;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed > 0 : false;
};

const gstHead = (ledger: string) => {
  const x = (ledger || '').toLowerCase();
  if (x.includes('igst')) return 'IGST';
  if (x.includes('cgst')) return 'CGST';
  if (x.includes('sgst') || x.includes('utgst')) return 'SGST';
  if (x.includes('cess')) return 'CESS';
  return 'OTHER';
};

const deriveSeries = (inv: string) => (inv.split('/')[0] || inv.split('-')[0] || 'DEFAULT') || 'DEFAULT';

const monthLabelFromMonthKey = (monthKey: string) => {
  const [mm, yyyy] = monthKey.split('/').map(Number);
  if (!mm || !yyyy) return monthKey;
  const d = new Date(yyyy, mm - 1, 1);
  return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
};

const monthSortValue = (monthKey: string) => {
  const [mm, yyyy] = monthKey.split('/').map(Number);
  if (!mm || !yyyy) return 0;
  return yyyy * 100 + mm;
};

const signedAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const groupVoucherRows = (entries: LedgerEntry[]) => {
  const map = new Map<
    string,
    { voucher_number: string; date: string; voucher_type: string; entries: LedgerEntry[] }
  >();

  entries.forEach((entry, index) => {
    const voucherNumber =
      String(entry.voucher_number || entry.invoice_number || '').trim() || `UNKNOWN-${index + 1}`;
    const date = String(entry.date || '').trim();
    const voucherType = String(entry.voucher_type || '').trim();
    const key = `${voucherNumber}__${date}__${voucherType}`;
    if (!map.has(key)) {
      map.set(key, {
        voucher_number: voucherNumber,
        date,
        voucher_type: voucherType,
        entries: [],
      });
    }
    map.get(key)!.entries.push(entry);
  });

  return Array.from(map.values());
};

const downloadTextFile = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const styleTabularSheet = (
  XLSX: any,
  worksheet: any,
  options: { cols?: Array<{ wch: number }>; numberHeaders?: string[]; headerRow?: number }
) => {
  const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
  if (!range) return;

  if (Array.isArray(options.cols)) worksheet['!cols'] = options.cols;

  const headerRow = options.headerRow ?? 0;
  const numberHeaders = new Set(options.numberHeaders || []);
  const numberColumns = new Set<number>();

  for (let c = range.s.c; c <= range.e.c; c++) {
    const ref = XLSX.utils.encode_cell({ r: headerRow, c });
    const cell = worksheet[ref];
    if (!cell) continue;
    if (numberHeaders.has(String(cell.v || ''))) numberColumns.add(c);
  }

  const border = {
    top: { style: 'thin', color: { rgb: 'D1D5DB' } },
    right: { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left: { style: 'thin', color: { rgb: 'D1D5DB' } },
  };

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[ref];
      if (!cell) continue;
      const isHeader = r === headerRow;
      const isNumberCell = numberColumns.has(c) && typeof cell.v === 'number';
      cell.s = {
        border,
        alignment: { horizontal: isHeader ? 'center' : isNumberCell ? 'right' : 'left', vertical: 'center' },
        font: { name: 'Calibri', sz: isHeader ? 11 : 10, bold: isHeader, color: { rgb: '0F172A' } },
        fill: { fgColor: { rgb: isHeader ? 'E2E8F0' : 'FFFFFF' } },
        ...(isNumberCell ? { numFmt: '#,##0.00' } : {}),
      };
    }
  }
};

const PLACE_OF_SUPPLY_KEYS = [
  'place_of_supply',
  'placeOfSupply',
  'Place Of Supply',
  'Place of Supply',
  'pos',
  'POS',
  'state',
  'State',
  'state_name',
  'State Name',
];

const resolvePlaceOfSupply = (entries: LedgerEntry[]): string => {
  for (const entry of entries) {
    for (const key of PLACE_OF_SUPPLY_KEYS) {
      const raw = (entry as any)?.[key];
      if (raw === undefined || raw === null) continue;
      const value = String(raw).trim();
      if (value) return value;
    }
  }
  return '';
};

const resolvePartyName = (entries: LedgerEntry[]): string => {
  const byPartyName = entries.map((e) => String(e.party_name || '').trim()).find((x) => x.length > 0);
  if (byPartyName) return byPartyName;

  const creditorLedger = entries.find((e) => {
    const primary = (e.TallyPrimary || '').toLowerCase();
    const parent = (e.TallyParent || '').toLowerCase();
    return primary.includes('creditor') || parent.includes('creditor');
  });
  if (creditorLedger?.Ledger && String(creditorLedger.Ledger).trim()) return String(creditorLedger.Ledger).trim();

  return 'Unknown Party';
};

const PurchaseGSTRegister: React.FC<PurchaseGSTRegisterProps> = ({
  data,
  externalSelectedLedgers,
  externalRcmLedgers = [],
  onLedgersUpdate,
}) => {
  const [sqlRows, setSqlRows] = useState<LedgerEntry[]>([]);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState('');

  const [internalSelectedLedgers, setInternalSelectedLedgers] = useState<string[]>([]);
  const selectedLedgers = externalSelectedLedgers || internalSelectedLedgers;
  const setSelectedLedgers = (value: string[] | ((prev: string[]) => string[])) => {
    if (onLedgersUpdate) {
      const next = typeof value === 'function' ? value(selectedLedgers) : value;
      onLedgersUpdate(next);
    } else {
      setInternalSelectedLedgers(value);
    }
  };

  const [ledgerSearch, setLedgerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('All');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [onlyZeroCoreGst, setOnlyZeroCoreGst] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'All' | 'B2B' | 'RCM' | 'IMPORTGOODS OR SERVICE' | 'Blank'>('All');
  const [reverseChargeFilter, setReverseChargeFilter] = useState<'All' | 'Yes' | 'No'>('All');
  const [voucherTypeFilter, setVoucherTypeFilter] = useState('All');
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadSqlRows = async () => {
      if (data.length > 0) {
        setSqlRows([]);
        setSqlError('');
        setSqlLoading(false);
        return;
      }

      setSqlLoading(true);
      setSqlError('');
      try {
        const sqlAvailable = await isSqlBackendAvailable();
        if (!sqlAvailable) {
          if (!cancelled) setSqlLoading(false);
          return;
        }
        const rows = await fetchSqlModuleRows({
          module: 'purchase',
          selectedLedgers,
          selectedRcmLedgers: externalRcmLedgers,
        });
        if (cancelled) return;
        setSqlRows(rows);
      } catch (error: any) {
        if (cancelled) return;
        setSqlError(error?.message || 'Unable to load optimized SQL purchase dataset.');
      } finally {
        if (!cancelled) setSqlLoading(false);
      }
    };

    loadSqlRows();
    return () => {
      cancelled = true;
    };
  }, [data.length, selectedLedgers.join('|'), externalRcmLedgers.join('|')]);

  const sourceData = data.length > 0 ? data : sqlRows;

  const allLedgers = useMemo(() => getUniqueLedgers(sourceData), [sourceData]);
  const visibleLedgers = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return allLedgers;
    return allLedgers.filter((x) => x.toLowerCase().includes(q));
  }, [allLedgers, ledgerSearch]);

  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (allLedgers.length === 0) return;
    if (selectedLedgers.length > 0) {
      autoSelectedRef.current = true;
      return;
    }
    const gstNamedLedgers = allLedgers.filter((ledger) => ledger.toLowerCase().includes('gst'));
    setSelectedLedgers(gstNamedLedgers);
    autoSelectedRef.current = true;
  }, [allLedgers, selectedLedgers.length]);

  const voucherRecoRows = useMemo(() => {
    const selected = new Set(selectedLedgers);
    const rcmSelected = new Set(externalRcmLedgers.map((x) => String(x || '').toLowerCase().trim()));
    const accountingOnlyData = sourceData.filter(isAccountingVoucherEntry);
    return groupVoucherRows(accountingOnlyData)
      .map((voucher) => {
        const entries = voucher.entries || [];
        const expensePrimaryEntries = entries.filter(isPurchaseExpenseFixedAssetByPrimary);
        const purchasePrimaryEntries = entries.filter(isPurchaseByPrimary);
        const expenseOnlyPrimaryEntries = entries.filter(isExpenseByPrimary);
        const fixedAssetPrimaryEntries = entries.filter(isFixedAssetByPrimary);
        const selectedLedgerHits = entries.filter((e: LedgerEntry) => selected.has(e.Ledger));

        const hasPrimaryImpact = expensePrimaryEntries.length > 0;
        const hitsSelectedGst = selectedLedgerHits.length > 0;
        if (!hasPrimaryImpact && !hitsSelectedGst) return null;

        const purchasePrimaryValue = purchasePrimaryEntries.reduce((a: number, e: LedgerEntry) => a + signedAmount(e.amount), 0);
        const expensePrimaryValue = expenseOnlyPrimaryEntries.reduce((a: number, e: LedgerEntry) => a + signedAmount(e.amount), 0);
        const fixedAssetPrimaryValue = fixedAssetPrimaryEntries.reduce((a: number, e: LedgerEntry) => a + signedAmount(e.amount), 0);

        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        selectedLedgerHits.forEach((e: LedgerEntry) => {
          const amt = signedAmount(e.amount);
          const head = gstHead(e.Ledger);
          if (head === 'IGST') igst += amt;
          else if (head === 'CGST') cgst += amt;
          else if (head === 'SGST') sgst += amt;
        });

        const taxable = purchasePrimaryValue + expensePrimaryValue + fixedAssetPrimaryValue;
        const tax = igst + cgst + sgst;

        const invoice = sanitizeInvoice(
          voucher.voucher_number || entries.find((e: LedgerEntry) => e.invoice_number)?.invoice_number || ''
        );
        const gstinRaw =
          entries
            .map((e: LedgerEntry) => String((e as any).gstn || (e as any).GSTN || e.gstin || ''))
            .find((x: string) => x.trim()) || '';
        const date = toDDMMYYYY(voucher.date);
        const booksMonth = booksMonthNameFromDate(date);
        const placeOfSupply = resolvePlaceOfSupply(entries);
        const purchaseExpenseLedgers = Array.from(
          new Set(
            expensePrimaryEntries
              .map((e: LedgerEntry) => String(e.Ledger || '').trim())
              .filter((x: string) => x.length > 0)
          )
        ).join(', ');

        const partyGstinUin = normalizeGstin(gstinRaw);
        const hasImportLedger = purchaseExpenseLedgers.toLowerCase().includes('import');
        const reverseCharge = entries.some((e: LedgerEntry) => rcmSelected.has(String(e.Ledger || '').toLowerCase().trim()))
          ? 'Yes'
          : 'No';
        const type = reverseCharge === 'Yes' ? 'RCM' : hasImportLedger ? 'IMPORTGOODS OR SERVICE' : partyGstinUin ? 'B2B' : '';

        return {
          date,
          invoice,
          voucherType: String(voucher.voucher_type || ''),
          party: resolvePartyName(entries),
          partyGstinUin,
          placeOfSupply,
          purchaseExpenseLedgers,
          type,
          reverseCharge,
          booksMonth,
          purchasePrimaryValue,
          expensePrimaryValue,
          fixedAssetPrimaryValue,
          hasPrimaryImpact,
          hitsSelectedGst,
          taxable,
          igst,
          cgst,
          sgst,
          tax,
        } as VoucherRecoRow;
      })
      .filter((x): x is VoucherRecoRow => !!x);
  }, [sourceData, selectedLedgers, externalRcmLedgers]);

  const rows = useMemo(() => {
    let out = voucherRecoRows
      .map((row) => ({
        ...row,
        monthKey: monthKeyFromDate(row.date),
        issue: '',
        placeOfSupply: row.placeOfSupply,
        itcAvailability: '',
        purchaseExpenseLedgers: row.purchaseExpenseLedgers,
        month3b: '',
      } as RegRow));

    const counts = new Map<string, number>();
    out.forEach((row) => {
      const key = `${row.monthKey}|${row.invoice}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    out = out.map((row) => {
      const issues: string[] = [];
      if (!row.invoice) issues.push('Blank Vch N.');
      if (row.invoice.length > 16) issues.push('Length > 16');
      if ((counts.get(`${row.monthKey}|${row.invoice}`) || 0) > 1) issues.push('Duplicate');
      return { ...row, issue: issues.join(' | ') };
    });

    return out.sort((a, b) => {
      const [ad, am, ay] = a.date.split('/').map(Number);
      const [bd, bm, by] = b.date.split('/').map(Number);
      return new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime();
    });
  }, [voucherRecoRows]);

  const months = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.booksMonth).filter(Boolean))).sort(
      (a, b) => MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b)
    );
  }, [rows]);

  const voucherTypeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.voucherType).filter(Boolean))).sort(),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (monthFilter !== 'All' && row.booksMonth !== monthFilter) return false;
      if (onlyIssues && !row.issue) return false;
      if (onlyZeroCoreGst && !(Math.abs(row.igst) <= 0.005 && Math.abs(row.cgst) <= 0.005 && Math.abs(row.sgst) <= 0.005))
        return false;
      if (typeFilter === 'Blank' && row.type !== '') return false;
      if (typeFilter !== 'All' && typeFilter !== 'Blank' && row.type !== typeFilter) return false;
      if (reverseChargeFilter !== 'All' && row.reverseCharge !== reverseChargeFilter) return false;
      if (voucherTypeFilter !== 'All' && row.voucherType !== voucherTypeFilter) return false;
      if (!q) return true;
      return (
        row.invoice.toLowerCase().includes(q) ||
        row.voucherType.toLowerCase().includes(q) ||
        row.party.toLowerCase().includes(q) ||
        row.purchaseExpenseLedgers.toLowerCase().includes(q) ||
        row.partyGstinUin.toLowerCase().includes(q) ||
        row.placeOfSupply.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q)
      );
    });
  }, [rows, search, monthFilter, onlyIssues, onlyZeroCoreGst, typeFilter, reverseChargeFilter, voucherTypeFilter]);

  const docsSummary = useMemo(() => {
    const map = new Map<string, { voucherType: string; series: string; total: number; cancelled: number }>();
    rows.forEach((row) => {
      const key = `Purchase Register|${deriveSeries(row.invoice)}`;
      const current = map.get(key) || {
        voucherType: 'Purchase Register',
        series: deriveSeries(row.invoice),
        total: 0,
        cancelled: 0,
      };
      current.total += 1;
      if (row.issue && row.issue.toLowerCase().includes('cancel')) current.cancelled += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).map((x) => ({ ...x, net: x.total - x.cancelled }));
  }, [rows]);

  const voucherWiseRecoRows = useMemo(() => {
    return voucherRecoRows
      .sort((a, b) => {
        const [ad, am, ay] = a.date.split('/').map(Number);
        const [bd, bm, by] = b.date.split('/').map(Number);
        return new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime();
      });
  }, [voucherRecoRows]);

  const filteredVoucherRecoRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voucherWiseRecoRows.filter((row) => {
      if (monthFilter !== 'All' && row.booksMonth !== monthFilter) return false;
      if (onlyZeroCoreGst && !(Math.abs(row.igst) <= 0.005 && Math.abs(row.cgst) <= 0.005 && Math.abs(row.sgst) <= 0.005))
        return false;
      if (typeFilter === 'Blank' && row.type !== '') return false;
      if (typeFilter !== 'All' && typeFilter !== 'Blank' && row.type !== typeFilter) return false;
      if (reverseChargeFilter !== 'All' && row.reverseCharge !== reverseChargeFilter) return false;
      if (voucherTypeFilter !== 'All' && row.voucherType !== voucherTypeFilter) return false;
      if (!q) return true;
      return (
        row.invoice.toLowerCase().includes(q) ||
        row.voucherType.toLowerCase().includes(q) ||
        row.party.toLowerCase().includes(q) ||
        row.purchaseExpenseLedgers.toLowerCase().includes(q) ||
        row.partyGstinUin.toLowerCase().includes(q) ||
        row.placeOfSupply.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q)
      );
    });
  }, [voucherWiseRecoRows, search, monthFilter, onlyZeroCoreGst, typeFilter, reverseChargeFilter, voucherTypeFilter]);

  const monthSummaryRows = useMemo(() => {
    const source = rows.filter((row) => {
      if (monthFilter !== 'All' && row.booksMonth !== monthFilter) return false;
      if (onlyZeroCoreGst && !(Math.abs(row.igst) <= 0.005 && Math.abs(row.cgst) <= 0.005 && Math.abs(row.sgst) <= 0.005))
        return false;
      if (typeFilter === 'Blank' && row.type !== '') return false;
      if (typeFilter !== 'All' && typeFilter !== 'Blank' && row.type !== typeFilter) return false;
      if (reverseChargeFilter !== 'All' && row.reverseCharge !== reverseChargeFilter) return false;
      if (voucherTypeFilter !== 'All' && row.voucherType !== voucherTypeFilter) return false;
      return true;
    });

    const map = new Map<string, MonthlySummaryRow>();
    source.forEach((row) => {
      if (!map.has(row.monthKey)) {
        map.set(row.monthKey, {
          monthKey: row.monthKey,
          monthLabel: monthLabelFromMonthKey(row.monthKey),
          voucherCount: 0,
          taxable: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          tax: 0,
        });
      }
      const bucket = map.get(row.monthKey)!;
      bucket.voucherCount += 1;
      bucket.taxable += row.taxable;
      bucket.igst += row.igst;
      bucket.cgst += row.cgst;
      bucket.sgst += row.sgst;
      bucket.tax += row.tax;
    });

    return Array.from(map.values()).sort((a, b) => monthSortValue(a.monthKey) - monthSortValue(b.monthKey));
  }, [rows, monthFilter, onlyZeroCoreGst, typeFilter, reverseChargeFilter, voucherTypeFilter]);

  const recoTotals = useMemo(() => {
    return filteredVoucherRecoRows.reduce(
      (acc, row) => {
        acc.voucherCount += 1;
        if (row.hasPrimaryImpact) acc.primaryImpactVouchers += 1;
        if (!row.hasPrimaryImpact && row.hitsSelectedGst) acc.gstOnlyVouchers += 1;
        acc.purchasePrimary += row.purchasePrimaryValue;
        acc.expensePrimary += row.expensePrimaryValue;
        acc.fixedAssetPrimary += row.fixedAssetPrimaryValue;
        acc.taxable += row.taxable;
        acc.igst += row.igst;
        acc.cgst += row.cgst;
        acc.sgst += row.sgst;
        acc.tax += row.tax;
        return acc;
      },
      {
        voucherCount: 0,
        primaryImpactVouchers: 0,
        gstOnlyVouchers: 0,
        purchasePrimary: 0,
        expensePrimary: 0,
        fixedAssetPrimary: 0,
        taxable: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        tax: 0,
      }
    );
  }, [filteredVoucherRecoRows]);

  const recoTaxableDiff =
    recoTotals.taxable - (recoTotals.purchasePrimary + recoTotals.expensePrimary + recoTotals.fixedAssetPrimary);

  const exportRegister = async () => {
    if (!visibleRows.length) return;
    try {
      const XLSX = await import('xlsx-js-style');

      const registerAoa: any[][] = [
        [
          'Party GSTIN/UIN',
          'Party Name',
          'Vch N.',
          'Date',
          'Taxable',
          'IGST',
          'CGST',
          'SGST',
          'Tax',
          'Place of Supply',
          'Reverse Charge',
          'ITC Availability',
          'Type',
          'Purchase/Expense Ledgers',
          '3B Month',
          'Books Month',
          'Voucher Type',
        ],
      ];
      visibleRows.forEach((r) => {
        registerAoa.push([
          r.partyGstinUin,
          r.party,
          r.invoice,
          r.date,
          r.taxable,
          r.igst,
          r.cgst,
          r.sgst,
          r.tax,
          r.placeOfSupply,
          r.reverseCharge,
          r.itcAvailability,
          r.type,
          r.purchaseExpenseLedgers,
          r.month3b,
          r.booksMonth,
          r.voucherType,
        ]);
      });

      const voucherRecoAoa: any[][] = [
        [
          'Date',
          'Vch N.',
          'Voucher Type',
          'Party',
          'Purchase (TallyPrimary)',
          'Expense (TallyPrimary)',
          'Fixed Asset (TallyPrimary)',
          'Purchase/Expense/Fixed Asset (TallyPrimary)',
          'Taxable',
          'IGST',
          'CGST',
          'SGST',
          'Tax',
          'Reverse Charge',
          'Type',
          'Books Month',
          'Inclusion Basis',
        ],
      ];
      filteredVoucherRecoRows.forEach((r) => {
        const inclusionBasis = r.hasPrimaryImpact
          ? r.hitsSelectedGst
            ? 'Primary + GST Hit'
            : 'Primary Impact'
          : 'GST Ledger Hit';
        voucherRecoAoa.push([
          r.date,
          r.invoice,
          r.voucherType,
          r.party,
          r.purchasePrimaryValue,
          r.expensePrimaryValue,
          r.fixedAssetPrimaryValue,
          r.taxable,
          r.taxable,
          r.igst,
          r.cgst,
          r.sgst,
          r.tax,
          r.reverseCharge,
          r.type,
          r.booksMonth,
          inclusionBasis,
        ]);
      });
      voucherRecoAoa.push([
        '',
        `TOTAL (${recoTotals.voucherCount.toLocaleString('en-IN')} vouchers)`,
        '',
        '',
        recoTotals.purchasePrimary,
        recoTotals.expensePrimary,
        recoTotals.fixedAssetPrimary,
        recoTotals.taxable,
        recoTotals.taxable,
        recoTotals.igst,
        recoTotals.cgst,
        recoTotals.sgst,
        recoTotals.tax,
        '',
        '',
        '',
        '',
      ]);

      const sheet1 = XLSX.utils.aoa_to_sheet(registerAoa);
      const sheet2 = XLSX.utils.aoa_to_sheet(voucherRecoAoa);
      const summaryAoa: any[][] = [
        ['Purchase GST Register - Grand Totals'],
        ['Exported Register Rows', visibleRows.length],
        ['Voucher Reco Rows', recoTotals.voucherCount],
        ['Taxable Total', recoTotals.taxable],
        ['IGST Total', recoTotals.igst],
        ['CGST Total', recoTotals.cgst],
        ['SGST Total', recoTotals.sgst],
        ['Tax Total', recoTotals.tax],
        ['Purchase (TallyPrimary)', recoTotals.purchasePrimary],
        ['Expense (TallyPrimary)', recoTotals.expensePrimary],
        ['Fixed Asset (TallyPrimary)', recoTotals.fixedAssetPrimary],
        ['Taxable - (Purchase + Expense + Fixed Asset)', recoTaxableDiff],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
      summarySheet['!cols'] = [{ wch: 54 }, { wch: 20 }];

      sheet1['!cols'] = [
        { wch: 18 },
        { wch: 28 },
        { wch: 16 },
        { wch: 12 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 18 },
        { wch: 14 },
        { wch: 16 },
        { wch: 24 },
        { wch: 44 },
        { wch: 12 },
        { wch: 14 },
        { wch: 18 },
      ];
      sheet2['!cols'] = [
        { wch: 12 },
        { wch: 16 },
        { wch: 18 },
        { wch: 28 },
        { wch: 18 },
        { wch: 18 },
        { wch: 20 },
        { wch: 24 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 24 },
        { wch: 14 },
        { wch: 22 },
      ];
      sheet1['!autofilter'] = { ref: `A1:Q1` };
      sheet2['!autofilter'] = { ref: `A1:Q1` };

      const border = {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      };
      const headerStyle = {
        fill: { fgColor: { rgb: 'F1F5F9' } },
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '0F172A' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border,
      };
      const rowStyle = (isAlt: boolean) => ({
        fill: { fgColor: { rgb: isAlt ? 'F8FAFC' : 'FFFFFF' } },
        font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border,
      });
      const numericStyle = (isAlt: boolean) => ({
        ...rowStyle(isAlt),
        alignment: { horizontal: 'right', vertical: 'center' },
        numFmt: '#,##0.00',
      });

      const applyStyles = (ws: any, rowsCount: number, colsCount: number, numericCols: number[], typeCol?: number) => {
        for (let c = 0; c < colsCount; c++) {
          const ref = XLSX.utils.encode_cell({ r: 0, c });
          if (ws[ref]) ws[ref].s = headerStyle;
        }
        for (let r = 1; r < rowsCount; r++) {
          const isAlt = r % 2 === 0;
          for (let c = 0; c < colsCount; c++) {
            const ref = XLSX.utils.encode_cell({ r, c });
            if (!ws[ref]) continue;
            ws[ref].s = numericCols.includes(c) ? numericStyle(isAlt) : rowStyle(isAlt);
          }
          if (typeof typeCol === 'number') {
            const typeRef = XLSX.utils.encode_cell({ r, c: typeCol });
            const cell = ws[typeRef];
            const typeValue = String(cell?.v || '').toUpperCase();
            if (typeValue === 'RCM' || typeValue === 'IMPORTGOODS OR SERVICE') {
              cell.s = {
                ...(cell.s || rowStyle(isAlt)),
                fill: { fgColor: { rgb: 'E5E7EB' } },
                font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '111827' } },
              };
            }
          }
        }
      };

      applyStyles(sheet1, registerAoa.length, 17, [4, 5, 6, 7, 8], 12);
      applyStyles(sheet2, voucherRecoAoa.length, 17, [4, 5, 6, 7, 8, 9, 10, 11, 12], 14);

      const totalRowIndex = voucherRecoAoa.length - 1;
      for (let c = 0; c < 17; c++) {
        const ref = XLSX.utils.encode_cell({ r: totalRowIndex, c });
        if (!sheet2[ref]) continue;
        const totalStyle: any = {
          fill: { fgColor: { rgb: 'E2E8F0' } },
          font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '0F172A' } },
          alignment: { horizontal: c >= 4 ? 'right' : 'left', vertical: 'center' },
          border,
        };
        if (c >= 4 && c <= 12) totalStyle.numFmt = '#,##0.00';
        sheet2[ref].s = totalStyle;
      }

      const summaryTitleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
      if (summarySheet[summaryTitleRef]) {
        summarySheet[summaryTitleRef].s = {
          fill: { fgColor: { rgb: 'F1F5F9' } },
          font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: '0F172A' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border,
        };
      }
      for (let r = 1; r < summaryAoa.length; r++) {
        for (let c = 0; c < 2; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!summarySheet[ref]) continue;
          const style: any = {
            fill: { fgColor: { rgb: r % 2 === 0 ? 'FFFFFF' : 'F8FAFC' } },
            font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' }, bold: c === 0 },
            alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
            border,
          };
          if (c === 1) style.numFmt = '#,##0.00';
          summarySheet[ref].s = style;
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
      XLSX.utils.book_append_sheet(workbook, sheet1, 'Purchase GST Register');
      XLSX.utils.book_append_sheet(workbook, sheet2, 'Voucher Reco Summary');

      const now = new Date();
      const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
      XLSX.writeFile(workbook, `Purchase_GST_Register_${stamp}.xlsx`, { compression: true });
    } catch (error) {
      console.error(error);
      window.alert('Unable to export styled Purchase Register Excel. Please retry.');
    }
  };

  const exportMonthSummaryExcel = async () => {
    if (!monthSummaryRows.length) return;
    try {
      const XLSX = await import('xlsx-js-style');
      const exportRows = monthSummaryRows.map((row) => ({
        Month: row.monthLabel,
        Vouchers: row.voucherCount,
        Taxable: row.taxable,
        IGST: row.igst,
        CGST: row.cgst,
        SGST: row.sgst,
        Tax: row.tax,
      }));

      const sheet = XLSX.utils.json_to_sheet(exportRows);
      styleTabularSheet(XLSX, sheet, {
        cols: [{ wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }],
        numberHeaders: ['Vouchers', 'Taxable', 'IGST', 'CGST', 'SGST', 'Tax'],
      });
      sheet['!autofilter'] = { ref: `A1:G${Math.max(1, exportRows.length + 1)}` };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Monthly Purchase Summary');
      XLSX.writeFile(workbook, `Purchase_Register_Monthly_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`, {
        compression: true,
        cellStyles: true,
      });
    } catch (error) {
      console.error(error);
      window.alert('Unable to export monthly purchase summary Excel. Please retry.');
    }
  };

  const exportMonthSummaryMarkdown = () => {
    if (!monthSummaryRows.length) return;
    const lines: string[] = [];
    lines.push('# Purchase Register Month-wise Summary');
    lines.push('');
    lines.push(`Generated: ${toDDMMYYYY(new Date().toISOString().slice(0, 10))}`);
    lines.push(`Books Month Filter: ${monthFilter === 'All' ? 'All Months' : monthFilter}`);
    lines.push('');
    lines.push('| Month | Vouchers | Taxable | IGST | CGST | SGST | Tax |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    monthSummaryRows.forEach((row) => {
      lines.push(
        `| ${row.monthLabel} | ${row.voucherCount} | ${row.taxable.toFixed(2)} | ${row.igst.toFixed(2)} | ${row.cgst.toFixed(2)} | ${row.sgst.toFixed(2)} | ${row.tax.toFixed(2)} |`
      );
    });
    downloadTextFile(lines.join('\n'), `Purchase_Register_Monthly_Summary_${new Date().toISOString().slice(0, 10)}.md`);
  };

  const toggleLedger = (ledger: string) => {
    setSelectedLedgers((prev) => (prev.includes(ledger) ? prev.filter((x) => x !== ledger) : [...prev, ledger]));
  };

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm flex items-start gap-3">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">Step 1: Select purchase GST ledgers below before reviewing this register.</p>
          <p className="text-xs mt-1">
            Inclusion logic: is_accounting_voucher = 1 and (TallyPrimary has Purchase/Expense/Fixed Asset OR selected GST
            ledger is hit). Taxable is only from Purchase/Expense/Fixed Asset lines by TallyPrimary.
          </p>
        </div>
      </div>

      {sqlLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
          Loading optimized SQL purchase dataset...
        </div>
      )}
      {sqlError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          {sqlError}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input
              value={ledgerSearch}
              onChange={(e) => setLedgerSearch(e.target.value)}
              placeholder="Search GST ledgers"
              className="pl-7 pr-3 py-2 border border-slate-300 rounded text-sm w-72"
            />
          </div>
          <button
            onClick={() => setSelectedLedgers(visibleLedgers)}
            className="px-3 py-2 rounded-lg text-sm border bg-blue-50 border-blue-200 text-blue-700"
          >
            Select Visible
          </button>
          <button
            onClick={() => setSelectedLedgers([])}
            className="px-3 py-2 rounded-lg text-sm border bg-white border-slate-300 text-slate-700"
          >
            Clear
          </button>
          <div className="ml-auto text-xs text-slate-500">Selected ledgers: {selectedLedgers.length}</div>
        </div>
        <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {visibleLedgers.map((ledger) => {
              const isSelected = selectedLedgers.includes(ledger);
              return (
                <button
                  key={ledger}
                  onClick={() => toggleLedger(ledger)}
                  className={`text-left px-3 py-2 rounded border text-sm flex items-center gap-2 ${
                    isSelected ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  <span className="truncate">{ledger}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-2 items-center">
        <button onClick={exportRegister} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2">
          <Download size={15} />
          Export Register
        </button>
        <button onClick={exportMonthSummaryExcel} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-2">
          <Download size={15} />
          Month Summary Excel
        </button>
        <button onClick={exportMonthSummaryMarkdown} className="px-3 py-2 bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2">
          <Download size={15} />
          Month Summary Markdown
        </button>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party/vch/ledger/gstin"
            className="pl-7 pr-3 py-2 border border-slate-300 rounded text-sm w-72"
          />
        </div>
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="px-2 py-2 border border-slate-300 rounded text-sm">
          <option value="All">All Books Months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="px-2 py-2 border border-slate-300 rounded text-sm">
          <option value="All">All Types</option>
          <option value="B2B">B2B</option>
          <option value="RCM">RCM</option>
          <option value="IMPORTGOODS OR SERVICE">IMPORTGOODS OR SERVICE</option>
          <option value="Blank">Blank Type</option>
        </select>
        <select
          value={reverseChargeFilter}
          onChange={(e) => setReverseChargeFilter(e.target.value as any)}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        >
          <option value="All">All RC</option>
          <option value="Yes">Reverse Charge: Yes</option>
          <option value="No">Reverse Charge: No</option>
        </select>
        <select
          value={voucherTypeFilter}
          onChange={(e) => setVoucherTypeFilter(e.target.value)}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        >
          <option value="All">All Voucher Types</option>
          {voucherTypeOptions.map((vType) => (
            <option key={vType} value={vType}>
              {vType}
            </option>
          ))}
        </select>
        <button
          onClick={() => setOnlyIssues((v) => !v)}
          className={`px-3 py-2 rounded-lg text-sm border ${
            onlyIssues ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-300 text-slate-600'
          }`}
        >
          {onlyIssues ? 'Issues Only: ON' : 'Issues Only: OFF'}
        </button>
        <button
          onClick={() => setOnlyZeroCoreGst((v) => !v)}
          className={`px-3 py-2 rounded-lg text-sm border ${
            onlyZeroCoreGst ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-300 text-slate-600'
          }`}
        >
          {onlyZeroCoreGst ? 'IGST/CGST/SGST = 0: ON' : 'IGST/CGST/SGST = 0: OFF'}
        </button>
        <div className="ml-auto text-xs text-slate-500">Rows: {visibleRows.length}</div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-auto">
        <div className="p-3 font-semibold text-sm">Purchase Register Month-wise Summary</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left">Month</th>
              <th className="p-2 text-right">Vouchers</th>
              <th className="p-2 text-right">Taxable</th>
              <th className="p-2 text-right">IGST</th>
              <th className="p-2 text-right">CGST</th>
              <th className="p-2 text-right">SGST</th>
              <th className="p-2 text-right">Tax</th>
            </tr>
          </thead>
          <tbody>
            {monthSummaryRows.map((row) => (
              <tr key={row.monthKey} className="border-t">
                <td className="p-2">{row.monthLabel}</td>
                <td className="p-2 text-right">{row.voucherCount.toLocaleString('en-IN')}</td>
                <td className="p-2 text-right">{row.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right">{row.igst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right">{row.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right">{row.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right font-semibold">{row.tax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
            {monthSummaryRows.length === 0 && (
              <tr>
                <td className="p-8 text-center text-slate-400" colSpan={7}>
                  No month summary rows for current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-auto">
        <div className="p-3 font-semibold text-sm">Purchase GST Register</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left">Party GSTIN/UIN</th>
              <th className="p-2 text-left">Party</th>
              <th className="p-2 text-left">Vch N.</th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-right">Taxable</th>
              <th className="p-2 text-right">IGST</th>
              <th className="p-2 text-right">CGST</th>
              <th className="p-2 text-right">SGST</th>
              <th className="p-2 text-right">Tax</th>
              <th className="p-2 text-left">Place of Supply</th>
              <th className="p-2 text-left">Reverse Charge</th>
              <th className="p-2 text-left">ITC Availability</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Purchase/Expense Ledgers</th>
              <th className="p-2 text-left">3B Month</th>
              <th className="p-2 text-left">Books Month</th>
              <th className="p-2 text-left">Voucher Type</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={`${r.invoice}-${i}`} className="border-t">
                <td className="p-2 font-mono">{r.partyGstinUin || '-'}</td>
                <td className="p-2">{r.party}</td>
                <td className={`p-2 font-medium ${r.issue ? 'text-red-600' : ''}`}>{r.invoice}</td>
                <td className="p-2">{r.date}</td>
                <td className="p-2 text-right">{r.taxable.toLocaleString('en-IN')}</td>
                <td className="p-2 text-right">{r.igst.toLocaleString('en-IN')}</td>
                <td className="p-2 text-right">{r.cgst.toLocaleString('en-IN')}</td>
                <td className="p-2 text-right">{r.sgst.toLocaleString('en-IN')}</td>
                <td className="p-2 text-right font-semibold">{r.tax.toLocaleString('en-IN')}</td>
                <td className="p-2">{r.placeOfSupply || '-'}</td>
                <td className="p-2">{r.reverseCharge}</td>
                <td className="p-2">{r.itcAvailability || ''}</td>
                <td
                  className={`p-2 ${
                    r.type === 'RCM' || r.type === 'IMPORTGOODS OR SERVICE' ? 'bg-slate-100 text-slate-700 font-semibold' : ''
                  }`}
                >
                  {r.type || ''}
                </td>
                <td className="p-2">{r.purchaseExpenseLedgers || '-'}</td>
                <td className="p-2">{r.month3b}</td>
                <td className="p-2">{r.booksMonth}</td>
                <td className="p-2">{r.voucherType || '-'}</td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td className="p-8 text-center text-slate-400" colSpan={17}>
                  No purchase register rows for current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-auto">
        <div className="p-3 font-semibold text-sm">Taxable Value Reconciliation</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2 text-left">Component</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-2">Total Included Vouchers</td>
              <td className="p-2 text-right">{recoTotals.voucherCount.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Vouchers with Purchase/Expense/Fixed Asset (TallyPrimary)</td>
              <td className="p-2 text-right">{recoTotals.primaryImpactVouchers.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Vouchers included only due to selected GST ledger hit</td>
              <td className="p-2 text-right">{recoTotals.gstOnlyVouchers.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Purchase/Expense/Fixed Asset Amount (TallyPrimary)</td>
              <td className="p-2 text-right">{(recoTotals.purchasePrimary + recoTotals.expensePrimary + recoTotals.fixedAssetPrimary).toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Purchase Amount (TallyPrimary)</td>
              <td className="p-2 text-right">{recoTotals.purchasePrimary.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Expense Amount (TallyPrimary)</td>
              <td className="p-2 text-right">{recoTotals.expensePrimary.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">Fixed Asset Amount (TallyPrimary)</td>
              <td className="p-2 text-right">{recoTotals.fixedAssetPrimary.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t font-semibold bg-slate-50">
              <td className="p-2">Taxable Value in Register</td>
              <td className="p-2 text-right">{recoTotals.taxable.toLocaleString('en-IN')}</td>
            </tr>
            <tr className="border-t font-semibold bg-slate-50">
              <td className="p-2">Difference (Taxable - Purchase/Expense/Fixed Asset)</td>
              <td className="p-2 text-right">{recoTaxableDiff.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {docsSummary.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-auto">
          <div className="p-3 font-semibold text-sm">Documents Received During Tax Period (Summary)</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 text-left">Voucher Type</th>
                <th className="p-2 text-left">Series</th>
                <th className="p-2 text-right">Total Documents</th>
                <th className="p-2 text-right">Cancelled</th>
                <th className="p-2 text-right">Net Documents</th>
              </tr>
            </thead>
            <tbody>
              {docsSummary.map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{d.voucherType}</td>
                  <td className="p-2">{d.series}</td>
                  <td className="p-2 text-right">{d.total}</td>
                  <td className="p-2 text-right">{d.cancelled}</td>
                  <td className="p-2 text-right">{d.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PurchaseGSTRegister;
