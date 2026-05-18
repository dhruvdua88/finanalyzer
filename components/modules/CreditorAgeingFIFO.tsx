
import React, { useEffect, useMemo, useState } from 'react';
import { LedgerEntry } from '../../types';
import {
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface CreditorAgeingFIFOProps {
  data: LedgerEntry[];
}

interface OutstandingInvoice {
  voucherNumber: string;
  invoiceDate: string;
  ageDays: number;
  bucket: string;
  originalAmount: number;
  outstandingAmount: number;
}

interface PartyAgeing {
  party: string;
  openingBalance: number;
  closingBalance: number;
  closingPayable: number;
  advanceAmount: number;
  invoices: OutstandingInvoice[];
  bucketTotals: Record<string, number>;
}

const AGE_BUCKETS = [
  { label: '0-30', min: 0, max: 30 },
  { label: '31-60', min: 31, max: 60 },
  { label: '61-90', min: 61, max: 90 },
  { label: '91-180', min: 91, max: 180 },
  { label: '181-365', min: 181, max: 365 },
  { label: '>365', min: 366, max: Number.MAX_SAFE_INTEGER },
];

const formatAmount = (value: number): string =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toNumber = (value: any): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const splitDrCr = (value: number) => ({
  dr: value < 0 ? Math.abs(value) : 0,
  cr: value > 0 ? value : 0,
});

const isoToDdMmYyyy = (value: string): string => {
  const raw = (value || '').trim().split('T')[0];
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const ddMmYyyyToIso = (value: string): string | null => {
  const match = (value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

const computeBucket = (ageDays: number): string => {
  for (const bucket of AGE_BUCKETS) {
    if (ageDays >= bucket.min && ageDays <= bucket.max) return bucket.label;
  }
  return '>365';
};

const isSundryCreditorEntry = (entry: LedgerEntry): boolean => {
  const primary = (entry.TallyPrimary || '').toLowerCase();
  const parent = (entry.TallyParent || '').toLowerCase();
  return primary.includes('sundry creditor') || parent.includes('sundry creditor');
};

const initBucketTotals = () =>
  AGE_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.label] = 0;
    return acc;
  }, {} as Record<string, number>);

const CreditorAgeingFIFO: React.FC<CreditorAgeingFIFOProps> = ({ data }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [bucketFilter, setBucketFilter] = useState<'all' | 'advance' | string>('all');
  const [collapsedParties, setCollapsedParties] = useState<Record<string, boolean>>({});

  const asOfDateDefault = useMemo(() => {
    const dates = data.map((d) => d.date).filter(Boolean).sort();
    const latest = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);
    return isoToDdMmYyyy(latest);
  }, [data]);

  const [asOfDateText, setAsOfDateText] = useState(asOfDateDefault);

  const partyResults = useMemo(() => {
    const asOfIso =
      ddMmYyyyToIso(asOfDateText) ||
      data
        .map((d) => d.date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] ||
      new Date().toISOString().slice(0, 10);
    const asOfDate = new Date(`${asOfIso}T00:00:00`);

    const creditorEntries = data
      .filter(isSundryCreditorEntry)
      .filter((entry) => (entry.Ledger || '').trim().length > 0);

    const partyMap = new Map<string, LedgerEntry[]>();
    creditorEntries.forEach((entry) => {
      const party = entry.Ledger.trim();
      if (!partyMap.has(party)) partyMap.set(party, []);
      partyMap.get(party)!.push(entry);
    });

    const results: PartyAgeing[] = [];

    partyMap.forEach((entries, party) => {
      const sortedAll = [...entries].sort((a, b) => {
        if (a.date === b.date) return (a.voucher_number || '').localeCompare(b.voucher_number || '');
        return (a.date || '').localeCompare(b.date || '');
      });

      const sorted = sortedAll.filter((entry) => !entry.date || entry.date <= asOfIso);
      const firstDate = sorted.length > 0 ? sorted[0].date || asOfIso : asOfIso;
      const openingBalance = sortedAll.map((e) => toNumber(e.opening_balance)).find((v) => v !== 0) ?? 0;
      const periodMovement = sorted.reduce((acc, entry) => acc + toNumber(entry.amount), 0);
      const closingBalance = openingBalance + periodMovement;

      let carryDebit = 0;
      const payableQueue: Array<{
        voucherNumber: string;
        invoiceDate: string;
        originalAmount: number;
        outstandingAmount: number;
      }> = [];

      const applyDebit = (debitAmount: number) => {
        let remaining = debitAmount;
        for (let i = 0; i < payableQueue.length && remaining > 0; i++) {
          const item = payableQueue[i];
          if (item.outstandingAmount <= 0) continue;
          const used = Math.min(item.outstandingAmount, remaining);
          item.outstandingAmount -= used;
          remaining -= used;
        }
        if (remaining > 0) carryDebit += remaining;
      };

      const addCreditInvoice = (voucherNumber: string, invoiceDate: string, amount: number) => {
        let pending = amount;
        if (carryDebit > 0) {
          const offset = Math.min(carryDebit, pending);
          carryDebit -= offset;
          pending -= offset;
        }
        if (pending > 0) {
          payableQueue.push({
            voucherNumber,
            invoiceDate,
            originalAmount: amount,
            outstandingAmount: pending,
          });
        }
      };

      if (openingBalance > 0) addCreditInvoice('Opening Balance', firstDate, Math.abs(openingBalance));
      else if (openingBalance < 0) applyDebit(Math.abs(openingBalance));

      sorted.forEach((entry) => {
        const amount = toNumber(entry.amount);
        const invoiceDate = entry.date || firstDate;
        const voucherNumber = entry.invoice_number || entry.voucher_number || 'UNKNOWN';
        if (amount > 0) addCreditInvoice(voucherNumber, invoiceDate, Math.abs(amount));
        if (amount < 0) applyDebit(Math.abs(amount));
      });

      const invoices: OutstandingInvoice[] = payableQueue
        .filter((item) => item.outstandingAmount > 0.005)
        .map((item) => {
          const invoiceDate = new Date(`${item.invoiceDate}T00:00:00`);
          const ageDays = Math.max(
            0,
            Math.floor((asOfDate.getTime() - invoiceDate.getTime()) / (24 * 60 * 60 * 1000))
          );
          return {
            voucherNumber: item.voucherNumber,
            invoiceDate: item.invoiceDate,
            ageDays,
            bucket: computeBucket(ageDays),
            originalAmount: item.originalAmount,
            outstandingAmount: item.outstandingAmount,
          };
        });

      const bucketTotals = initBucketTotals();
      invoices.forEach((inv) => {
        bucketTotals[inv.bucket] += inv.outstandingAmount;
      });

      const closingPayable = invoices.reduce((acc, inv) => acc + inv.outstandingAmount, 0);
      results.push({
        party,
        openingBalance,
        closingBalance,
        closingPayable,
        advanceAmount: carryDebit,
        invoices,
        bucketTotals,
      });
    });

    return results.sort(
      (a, b) => b.closingPayable - b.advanceAmount - (a.closingPayable - a.advanceAmount)
    );
  }, [data, asOfDateText]);

  useEffect(() => {
    setCollapsedParties((prev) => {
      const next: Record<string, boolean> = {};
      partyResults.forEach((party) => {
        next[party.party] = prev[party.party] ?? false;
      });
      return next;
    });
  }, [partyResults]);

  const filteredPartyResults = useMemo(() => {
    const search = searchTerm.toLowerCase();

    return partyResults
      .map((party) => {
        let invoices = party.invoices;
        if (bucketFilter !== 'all' && bucketFilter !== 'advance') {
          invoices = invoices.filter((inv) => inv.bucket === bucketFilter);
        }
        return { ...party, invoices };
      })
      .filter((party) => {
        const matchesSearch =
          !search ||
          party.party.toLowerCase().includes(search) ||
          party.invoices.some((inv) => inv.voucherNumber.toLowerCase().includes(search));

        if (!matchesSearch) return false;
        if (bucketFilter === 'advance') return party.advanceAmount > 0;
        if (bucketFilter === 'all') return true;
        return party.invoices.length > 0;
      });
  }, [partyResults, searchTerm, bucketFilter]);

  const totals = useMemo(() => {
    return filteredPartyResults.reduce(
      (acc, party) => {
        const opening = splitDrCr(party.openingBalance);
        const closing = splitDrCr(party.closingBalance);
        acc.parties += 1;
        acc.totalOpeningDr += opening.dr;
        acc.totalOpeningCr += opening.cr;
        acc.totalClosingDr += closing.dr;
        acc.totalClosingCr += closing.cr;
        acc.totalPayable += party.closingPayable;
        acc.totalAdvance += party.advanceAmount;
        acc.invoiceCount += party.invoices.length;
        return acc;
      },
      {
        parties: 0,
        totalOpeningDr: 0,
        totalOpeningCr: 0,
        totalClosingDr: 0,
        totalClosingCr: 0,
        totalPayable: 0,
        totalAdvance: 0,
        invoiceCount: 0,
      }
    );
  }, [filteredPartyResults]);

  const reconciliation = useMemo(() => {
    const ledgerClosing = partyResults.reduce(
      (acc, party) => {
        const split = splitDrCr(party.closingBalance);
        acc.ledgerClosingDr += split.dr;
        acc.ledgerClosingCr += split.cr;
        acc.ledgerClosingSigned += party.closingBalance;
        acc.fifoPayable += party.closingPayable;
        acc.fifoAdvance += party.advanceAmount;
        return acc;
      },
      {
        ledgerClosingDr: 0,
        ledgerClosingCr: 0,
        ledgerClosingSigned: 0,
        fifoPayable: 0,
        fifoAdvance: 0,
      }
    );

    const diffCr = ledgerClosing.fifoPayable - ledgerClosing.ledgerClosingCr;
    const diffDr = ledgerClosing.fifoAdvance - ledgerClosing.ledgerClosingDr;
    const combinedFifo = ledgerClosing.fifoPayable + ledgerClosing.fifoAdvance;
    const combinedLedger = ledgerClosing.ledgerClosingDr + ledgerClosing.ledgerClosingCr;
    const diffCombined = combinedFifo - combinedLedger;
    const signedFifo = ledgerClosing.fifoPayable - ledgerClosing.fifoAdvance;
    const diffSigned = signedFifo - ledgerClosing.ledgerClosingSigned;

    const tolerance = 0.5;
    const within = (value: number) => Math.abs(value) <= tolerance;

    return {
      ...ledgerClosing,
      diffDr,
      diffCr,
      combinedFifo,
      combinedLedger,
      diffCombined,
      signedFifo,
      diffSigned,
      isPass: within(diffDr) && within(diffCr),
      tolerance,
    };
  }, [partyResults]);

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    filteredPartyResults.forEach((party) => {
      next[party.party] = false;
    });
    setCollapsedParties((prev) => ({ ...prev, ...next }));
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    filteredPartyResults.forEach((party) => {
      next[party.party] = true;
    });
    setCollapsedParties((prev) => ({ ...prev, ...next }));
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const asOn = asOfDateText;

    const summaryRows = filteredPartyResults.map((party) => {
      const opening = splitDrCr(party.openingBalance);
      const closing = splitDrCr(party.closingBalance);
      return {
        Party: party.party,
        'Opening Dr': opening.dr,
        'Opening Cr': opening.cr,
        'Closing Dr (Ledger)': closing.dr,
        'Closing Cr (Ledger)': closing.cr,
        'FIFO Closing Payable': party.closingPayable,
        'FIFO Advance': party.advanceAmount,
        'Net FIFO (Cr-Dr)': party.closingPayable - party.advanceAmount,
        Invoices: party.invoices.length,
        ...AGE_BUCKETS.reduce((acc, bucket) => {
          acc[bucket.label] = party.bucketTotals[bucket.label] || 0;
          return acc;
        }, {} as Record<string, number>),
      };
    });

    const detailRows: Record<string, any>[] = [];
    filteredPartyResults.forEach((party) => {
      if (party.invoices.length === 0) {
        detailRows.push({
          Party: party.party,
          'Voucher / Invoice': '',
          'Invoice Date': '',
          'Age (Days)': '',
          Bucket: '',
          'Original Amount': '',
          'Outstanding Amount': '',
          Remarks: party.advanceAmount > 0 ? `Advance ${formatAmount(party.advanceAmount)}` : 'No pending invoices',
        });
        return;
      }

      party.invoices.forEach((inv) => {
        detailRows.push({
          Party: party.party,
          'Voucher / Invoice': inv.voucherNumber,
          'Invoice Date': isoToDdMmYyyy(inv.invoiceDate),
          'Age (Days)': inv.ageDays,
          Bucket: inv.bucket,
          'Original Amount': inv.originalAmount,
          'Outstanding Amount': inv.outstandingAmount,
          Remarks: '',
        });
      });

      if (party.advanceAmount > 0) {
        detailRows.push({
          Party: party.party,
          'Voucher / Invoice': '',
          'Invoice Date': '',
          'Age (Days)': '',
          Bucket: 'Advance',
          'Original Amount': '',
          'Outstanding Amount': '',
          Remarks: `Advance ${formatAmount(party.advanceAmount)}`,
        });
      }
    });

      const wb = XLSX.utils.book_new();

    const summaryAoA: any[][] = [];
    const summaryHeaders = [
      'Creditor Ledger',
      'Opening Dr',
      'Opening Cr',
      'Closing Dr (Ledger)',
      'Closing Cr (Ledger)',
      'FIFO Closing Payable',
      'FIFO Advance',
      'Net FIFO (Cr-Dr)',
      'Invoices',
      ...AGE_BUCKETS.map((b) => b.label),
    ];

    summaryAoA.push(['Creditor FIFO Ageing Summary - Sundry Creditors']);
    summaryAoA.push([`As On: ${asOn}`]);
    summaryAoA.push(['Source: Ledgers under Sundry Creditors (TallyPrimary/TallyParent).']);
    summaryAoA.push([]);
    summaryAoA.push(summaryHeaders);

    summaryRows.forEach((row) => {
      summaryAoA.push([
        row.Party,
        row['Opening Dr'],
        row['Opening Cr'],
        row['Closing Dr (Ledger)'],
        row['Closing Cr (Ledger)'],
        row['FIFO Closing Payable'],
        row['FIFO Advance'],
        row['Net FIFO (Cr-Dr)'],
        row.Invoices,
        ...AGE_BUCKETS.map((b) => row[b.label] || 0),
      ]);
    });

    summaryAoA.push([]);
    summaryAoA.push([
      'TOTAL',
      totals.totalOpeningDr,
      totals.totalOpeningCr,
      totals.totalClosingDr,
      totals.totalClosingCr,
      totals.totalPayable,
      totals.totalAdvance,
      totals.totalPayable - totals.totalAdvance,
      totals.invoiceCount,
      ...AGE_BUCKETS.map((bucket) =>
        filteredPartyResults.reduce((acc, party) => acc + (party.bucketTotals[bucket.label] || 0), 0)
      ),
    ]);

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
    wsSummary['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: summaryHeaders.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: summaryHeaders.length - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: summaryHeaders.length - 1 } },
    ];
    wsSummary['!cols'] = [
      { wch: 34 },
      { wch: 13 },
      { wch: 13 },
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 14 },
      { wch: 16 },
      { wch: 10 },
      ...AGE_BUCKETS.map(() => ({ wch: 12 })),
    ];
    wsSummary['!autofilter'] = { ref: `A5:O${summaryAoA.length}` };

    const detailsAoA: any[][] = [];
    detailsAoA.push(['Creditor FIFO Ageing Details']);
    detailsAoA.push([`As On: ${asOn}`]);
    detailsAoA.push(['Source: Sundry Creditors only']);
    detailsAoA.push([]);
    detailsAoA.push([
      'Creditor Ledger',
      'Voucher / Invoice',
      'Invoice Date',
      'Age (Days)',
      'Bucket',
      'Original Amount',
      'Outstanding Amount',
      'Remarks',
    ]);

    detailRows.forEach((row) => {
      detailsAoA.push([
        row.Party,
        row['Voucher / Invoice'],
        row['Invoice Date'],
        row['Age (Days)'],
        row.Bucket,
        row['Original Amount'],
        row['Outstanding Amount'],
        row.Remarks,
      ]);
    });

    const wsDetails = XLSX.utils.aoa_to_sheet(detailsAoA);
    wsDetails['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
    ];
    wsDetails['!cols'] = [
      { wch: 34 },
      { wch: 22 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 18 },
      { wch: 28 },
    ];
    wsDetails['!autofilter'] = { ref: `A5:H${detailsAoA.length}` };

    const reconAoA: any[][] = [];
    reconAoA.push(['Reconciliation - Sundry Creditors Only']);
    reconAoA.push([`As On: ${asOn}`]);
    reconAoA.push([]);
    reconAoA.push(['Check', 'FIFO Value', 'Ledger Value', 'Difference', 'Status']);
    reconAoA.push([
      'Payable (Cr)',
      reconciliation.fifoPayable,
      reconciliation.ledgerClosingCr,
      reconciliation.diffCr,
      Math.abs(reconciliation.diffCr) <= reconciliation.tolerance ? 'PASS' : 'REVIEW',
    ]);
    reconAoA.push([
      'Advance (Dr)',
      reconciliation.fifoAdvance,
      reconciliation.ledgerClosingDr,
      reconciliation.diffDr,
      Math.abs(reconciliation.diffDr) <= reconciliation.tolerance ? 'PASS' : 'REVIEW',
    ]);
    reconAoA.push([
      'Combined (Dr + Cr)',
      reconciliation.combinedFifo,
      reconciliation.combinedLedger,
      reconciliation.diffCombined,
      Math.abs(reconciliation.diffCombined) <= reconciliation.tolerance ? 'PASS' : 'REVIEW',
    ]);
    reconAoA.push([
      'Signed Net (Cr - Dr)',
      reconciliation.signedFifo,
      reconciliation.ledgerClosingSigned,
      reconciliation.diffSigned,
      Math.abs(reconciliation.diffSigned) <= reconciliation.tolerance ? 'PASS' : 'REVIEW',
    ]);

    const wsRecon = XLSX.utils.aoa_to_sheet(reconAoA);
    wsRecon['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    ];
    wsRecon['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 12 }];
    wsRecon['!autofilter'] = { ref: `A4:E${reconAoA.length}` };

      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
      XLSX.utils.book_append_sheet(wb, wsDetails, 'Invoice FIFO');
      XLSX.utils.book_append_sheet(wb, wsRecon, 'Reconciliation');

      const dt = new Date();
      const stamp = `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
      XLSX.writeFile(wb, `Creditor_Ageing_FIFO_${stamp}.xlsx`, { compression: true });
    } catch (error) {
      console.error(error);
      window.alert('Unable to export Creditor Ageing Excel. Please retry.');
    }
  };

  const bucketGrandTotals = useMemo(
    () =>
      AGE_BUCKETS.reduce((acc, bucket) => {
        acc[bucket.label] = filteredPartyResults.reduce(
          (sum, party) => sum + (party.bucketTotals[bucket.label] || 0),
          0
        );
        return acc;
      }, {} as Record<string, number>),
    [filteredPartyResults]
  );
  const agedOver180 = (bucketGrandTotals['181-365'] || 0) + (bucketGrandTotals['>365'] || 0);
  const netPayable = totals.totalPayable - totals.totalAdvance;
  const isAsOfDateValid = ddMmYyyyToIso(asOfDateText) !== null;

  const BUCKET_STYLES = [
    { th: 'bg-emerald-50 text-emerald-700 border-emerald-100', td: (v: number) => v > 0 ? 'text-emerald-700 font-medium' : 'text-slate-300', foot: 'bg-emerald-50 text-emerald-800 font-semibold' },
    { th: 'bg-lime-50    text-lime-700    border-lime-100',    td: (v: number) => v > 0 ? 'text-lime-700 font-medium'    : 'text-slate-300', foot: 'bg-lime-50    text-lime-800    font-semibold' },
    { th: 'bg-yellow-50  text-yellow-700  border-yellow-100',  td: (v: number) => v > 0 ? 'text-yellow-700 font-medium'  : 'text-slate-300', foot: 'bg-yellow-50  text-yellow-800  font-semibold' },
    { th: 'bg-amber-50   text-amber-700   border-amber-100',   td: (v: number) => v > 0 ? 'text-amber-700 font-medium'   : 'text-slate-300', foot: 'bg-amber-50   text-amber-800   font-semibold' },
    { th: 'bg-orange-50  text-orange-700  border-orange-100',  td: (v: number) => v > 0 ? 'text-orange-700 font-semibold': 'text-slate-300', foot: 'bg-orange-50  text-orange-800  font-bold'     },
    { th: 'bg-red-50     text-red-700     border-red-100',     td: (v: number) => v > 0 ? 'text-red-700 font-bold'       : 'text-slate-300', foot: 'bg-red-50     text-red-800     font-bold'     },
  ];

  return (
    <div className="space-y-5 pb-8">

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {[
          { label: 'As On Date',   value: asOfDateText,                   cls: 'text-slate-800' },
          { label: 'Creditors',    value: String(totals.parties),          cls: 'text-slate-800' },
          { label: 'FIFO Payable', value: formatAmount(totals.totalPayable), cls: 'text-blue-700' },
          { label: 'Advance',      value: formatAmount(totals.totalAdvance),  cls: 'text-emerald-700' },
          { label: 'Net Payable',  value: formatAmount(netPayable),           cls: 'text-slate-800' },
          { label: 'Aged >180',    value: formatAmount(agedOver180),          cls: agedOver180 > 0 ? 'text-red-600' : 'text-slate-800' },
          { label: 'Open Invoices',value: String(totals.invoiceCount),    cls: 'text-slate-800' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
            <p className={`mt-1 text-lg font-bold truncate ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Reconciliation check ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Sundry Creditors Reconciliation</p>
            <p className="text-xs text-slate-400 mt-0.5">Ledger closing vs FIFO knock-off — tolerance ±{reconciliation.tolerance}</p>
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
            reconciliation.isPass
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {reconciliation.isPass ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {reconciliation.isPass ? 'Reconciled' : 'Review Differences'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            { label: 'Payable (Cr)', fifo: reconciliation.fifoPayable, ledger: reconciliation.ledgerClosingCr, diff: reconciliation.diffCr },
            { label: 'Advance (Dr)', fifo: reconciliation.fifoAdvance,  ledger: reconciliation.ledgerClosingDr, diff: reconciliation.diffDr },
            { label: 'Combined',     fifo: reconciliation.combinedFifo, ledger: reconciliation.combinedLedger,  diff: reconciliation.diffCombined },
            { label: 'Signed Net',   fifo: reconciliation.signedFifo,   ledger: reconciliation.ledgerClosingSigned, diff: reconciliation.diffSigned },
          ].map(({ label, fifo, ledger, diff }) => {
            const ok = Math.abs(diff) <= reconciliation.tolerance;
            return (
              <div key={label} className={`rounded-lg border p-3 ${ok ? 'border-emerald-100 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`font-semibold mb-1.5 ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{label}</p>
                <div className="space-y-0.5 text-slate-600">
                  <div className="flex justify-between gap-2"><span>FIFO</span><span className="font-mono">{formatAmount(fifo)}</span></div>
                  <div className="flex justify-between gap-2"><span>Ledger</span><span className="font-mono">{formatAmount(ledger)}</span></div>
                  <div className={`flex justify-between gap-2 font-semibold pt-1 border-t mt-1 ${ok ? 'border-emerald-200 text-emerald-700' : 'border-amber-300 text-amber-700'}`}>
                    <span>Diff</span><span className="font-mono">{formatAmount(diff)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-2.5 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search creditor or voucher…"
              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={asOfDateText}
            onChange={(e) => {
              const clean = e.target.value.replace(/[^\d]/g, '').slice(0, 8);
              if (clean.length <= 2) setAsOfDateText(clean);
              else if (clean.length <= 4) setAsOfDateText(`${clean.slice(0, 2)}/${clean.slice(2)}`);
              else setAsOfDateText(`${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4)}`);
            }}
            className={`w-36 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${
              isAsOfDateValid ? 'border-slate-200' : 'border-amber-400 bg-amber-50'
            }`}
            placeholder="As On dd/mm/yyyy"
          />
          <select
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Buckets</option>
            {AGE_BUCKETS.map((b) => <option key={b.label} value={b.label}>{b.label} days</option>)}
            <option value="advance">Advance Only</option>
          </select>
          <button onClick={expandAll}   className="px-3 py-2 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">Expand All</button>
          <button onClick={collapseAll} className="px-3 py-2 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">Collapse All</button>
          <button onClick={exportExcel} className="ml-auto px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 flex items-center gap-1.5">
            <Download size={14} /> Export Excel
          </button>
        </div>
        {!isAsOfDateValid && (
          <p className="mt-2 text-xs text-amber-600">Invalid date — use dd/mm/yyyy. Falling back to latest date in data.</p>
        )}
      </div>

      {/* ── Main table ── */}
      {filteredPartyResults.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center">
          <p className="text-slate-400 text-sm">No creditors match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Creditor Ageing Matrix (FIFO)</h3>
              <p className="text-xs text-slate-400 mt-0.5">Click any row to see invoice breakdown. Bucket colours indicate ageing risk.</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {AGE_BUCKETS.map((b, i) => (
                <span key={b.label} className={`hidden lg:inline px-2 py-0.5 rounded-full text-[10px] font-medium ${BUCKET_STYLES[i].th}`}>{b.label}</span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1380px] w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                <tr className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="w-8 px-3 py-3" />
                  <th className="px-4 py-3 text-left">Creditor</th>
                  <th className="px-3 py-3 text-right">Opening Dr</th>
                  <th className="px-3 py-3 text-right">Opening Cr</th>
                  <th className="px-3 py-3 text-right">Ledger Dr</th>
                  <th className="px-3 py-3 text-right">Ledger Cr</th>
                  <th className="px-3 py-3 text-right bg-blue-50 text-blue-700">FIFO Pay.</th>
                  <th className="px-3 py-3 text-right bg-emerald-50 text-emerald-700">Advance</th>
                  <th className="px-3 py-3 text-right">Net FIFO</th>
                  {AGE_BUCKETS.map((b, i) => (
                    <th key={b.label} className={`px-3 py-3 text-right border-x border-slate-100 ${BUCKET_STYLES[i].th}`}>{b.label}</th>
                  ))}
                  <th className="px-3 py-3 text-right text-slate-500">#Inv</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartyResults.map((party, rowIdx) => {
                  const opening    = splitDrCr(party.openingBalance);
                  const closing    = splitDrCr(party.closingBalance);
                  const isExpanded = !(collapsedParties[party.party] ?? false);
                  const net        = party.closingPayable - party.advanceAmount;
                  const toggleRow  = () => setCollapsedParties((p) => ({ ...p, [party.party]: isExpanded }));

                  return (
                    <React.Fragment key={party.party}>
                      {/* Summary row */}
                      <tr
                        onClick={toggleRow}
                        className={`cursor-pointer border-b border-slate-100 transition-colors ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-blue-50/40`}
                      >
                        <td className="px-3 py-3 text-slate-400">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">{party.party}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-500 text-xs">{opening.dr > 0 ? formatAmount(opening.dr) : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-500 text-xs">{opening.cr > 0 ? formatAmount(opening.cr) : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-600 text-xs">{closing.dr > 0 ? formatAmount(closing.dr) : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-600 text-xs">{closing.cr > 0 ? formatAmount(closing.cr) : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-blue-700 bg-blue-50/40">{formatAmount(party.closingPayable)}</td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-700 bg-emerald-50/30">{party.advanceAmount > 0 ? formatAmount(party.advanceAmount) : '—'}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">{formatAmount(net)}</td>
                        {AGE_BUCKETS.map((b, i) => {
                          const v = party.bucketTotals[b.label] || 0;
                          return (
                            <td key={b.label} className={`px-3 py-3 text-right font-mono text-xs border-x border-slate-100 ${BUCKET_STYLES[i].td(v)}`}>
                              {v > 0 ? formatAmount(v) : '—'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-right text-slate-500 text-xs">{party.invoices.length}</td>
                      </tr>

                      {/* Expanded invoice detail */}
                      {isExpanded && (
                        <tr className="border-b border-slate-200">
                          <td colSpan={9 + AGE_BUCKETS.length + 1} className="p-0">
                            <div className="mx-4 my-3 rounded-lg border border-slate-200 overflow-hidden">
                              {/* Sub-header chips */}
                              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium text-slate-600">{party.party}</span>
                                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                                  Payable {formatAmount(party.closingPayable)}
                                </span>
                                {party.advanceAmount > 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                                    Advance {formatAmount(party.advanceAmount)}
                                  </span>
                                )}
                                <span className="text-slate-400">Closing Dr {formatAmount(closing.dr)} · Cr {formatAmount(closing.cr)}</span>
                              </div>
                              {party.invoices.length === 0 ? (
                                <div className="px-4 py-5 text-sm text-slate-400">
                                  No pending invoices.{party.advanceAmount > 0 ? ` Excess payment of ${formatAmount(party.advanceAmount)} recorded as advance.` : ''}
                                </div>
                              ) : (
                                <table className="w-full text-sm">
                                  <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                    <tr>
                                      <th className="px-4 py-2.5 text-left">Voucher / Invoice</th>
                                      <th className="px-4 py-2.5 text-left">Invoice Date</th>
                                      <th className="px-4 py-2.5 text-right">Age (Days)</th>
                                      <th className="px-4 py-2.5 text-left">Bucket</th>
                                      <th className="px-4 py-2.5 text-right">Original Amount</th>
                                      <th className="px-4 py-2.5 text-right">Outstanding</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {party.invoices.map((inv, idx) => {
                                      const bi = AGE_BUCKETS.findIndex((b) => b.label === inv.bucket);
                                      const bs = BUCKET_STYLES[bi >= 0 ? bi : 0];
                                      return (
                                        <tr key={`${party.party}-${inv.voucherNumber}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                                          <td className="px-4 py-2.5 font-medium text-slate-700">{inv.voucherNumber}</td>
                                          <td className="px-4 py-2.5 text-slate-500">{isoToDdMmYyyy(inv.invoiceDate)}</td>
                                          <td className="px-4 py-2.5 text-right font-mono text-slate-600">{inv.ageDays}</td>
                                          <td className="px-4 py-2.5">
                                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${bs.th}`}>{inv.bucket}</span>
                                          </td>
                                          <td className="px-4 py-2.5 text-right font-mono text-slate-500">{formatAmount(inv.originalAmount)}</td>
                                          <td className={`px-4 py-2.5 text-right font-mono font-semibold ${bs.td(inv.outstandingAmount)}`}>
                                            {formatAmount(inv.outstandingAmount)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* Grand total footer */}
              <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                <tr className="text-xs font-semibold text-slate-700">
                  <td className="px-3 py-3" />
                  <td className="px-4 py-3">Total ({totals.parties} creditors)</td>
                  <td className="px-3 py-3 text-right font-mono">{formatAmount(totals.totalOpeningDr)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatAmount(totals.totalOpeningCr)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatAmount(totals.totalClosingDr)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatAmount(totals.totalClosingCr)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-blue-700 bg-blue-50">{formatAmount(totals.totalPayable)}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-700 bg-emerald-50">{formatAmount(totals.totalAdvance)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold">{formatAmount(netPayable)}</td>
                  {AGE_BUCKETS.map((b, i) => {
                    const v = bucketGrandTotals[b.label] || 0;
                    return (
                      <td key={b.label} className={`px-3 py-3 text-right font-mono border-x border-slate-200 ${BUCKET_STYLES[i].foot}`}>
                        {formatAmount(v)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right">{totals.invoiceCount}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreditorAgeingFIFO;


