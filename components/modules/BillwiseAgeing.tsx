// Bill-wise (true FIFO) ageing — surfaced inside the legacy Debtor / Creditor
// Ageing modules. Reads from TallyStore via context; doesn't depend on the
// flat LedgerEntry[] shim, so it shows the auditor-grade view alongside the
// existing voucher-date approximation.
//
// One component, two callers — pass `primary="Sundry Debtors"` or
// "Sundry Creditors" to scope it. The query handles sign convention so the
// visible totals always read positive in the dominant direction.

import React, { useMemo, useState } from 'react';
import { Download, ChevronDown, ChevronUp, Info } from 'lucide-react';
import {
  useTallyStore,
  getBillwiseOutstanding,
  summariseAgeing,
  type BillwiseOutstandingRow,
  type AgeingBucket,
} from '../../services/tally';

interface BillwiseAgeingProps {
  primary: 'Sundry Debtors' | 'Sundry Creditors';
  // Optional as-of date (ISO). Defaults to today.
  asOf?: string;
}

const BUCKETS: AgeingBucket[] = ['0-30', '31-60', '61-90', '91-180', '181-365', '>365', 'unaged'];

const formatINR = (n: number): string =>
  Math.abs(n) < 0.005 ? '—'
  : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDDMMYYYY = (iso: string): string => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const STATUS_BADGE: Record<BillwiseOutstandingRow['status'], string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  'fully-knocked-off': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overpaid: 'bg-orange-50 text-orange-700 border-orange-200',
  'on-account': 'bg-amber-50 text-amber-700 border-amber-200',
};

const BillwiseAgeing: React.FC<BillwiseAgeingProps> = ({ primary, asOf }) => {
  const store = useTallyStore();
  const [expanded, setExpanded] = useState(true);
  const [showSettled, setShowSettled] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const allRows = useMemo<BillwiseOutstandingRow[]>(() => {
    if (!store) return [];
    return getBillwiseOutstanding(store, { primary, asOf, openOnly: !showSettled });
  }, [store, primary, asOf, showSettled]);

  const summary = useMemo(() => summariseAgeing(allRows), [allRows]);

  // Display sign: debtor invoices land negative in the export, but readers
  // expect "receivables" to read positive. We flip when summary's first
  // total is dominantly negative.
  const flipSign = useMemo(() => {
    const grandTotal = summary.reduce((s, r) => s + r.total, 0);
    return grandTotal < 0 ? -1 : 1;
  }, [summary]);

  const grandTotal = useMemo(() => summary.reduce((s, r) => s + r.total, 0) * flipSign, [summary, flipSign]);
  const bucketTotals = useMemo(() => {
    const t: Record<AgeingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '181-365': 0, '>365': 0, 'unaged': 0 };
    for (const r of summary) for (const b of BUCKETS) t[b] += r.buckets[b] * flipSign;
    return t;
  }, [summary, flipSign]);

  const handleExport = async () => {
    if (allRows.length === 0) return;
    setIsExporting(true);
    try {
      const XLSX = await import('xlsx');
      const rows = allRows.map((r) => ({
        Party: r.party,
        'Primary Group': r.partyPrimary,
        'Bill Name': r.billName,
        'Bill Date': formatDDMMYYYY(r.billDate),
        'Original': r.originalAmount * flipSign,
        'Knockoff': r.knockoffAmount * flipSign,
        'On Account': r.onAccount * flipSign,
        'Advance': r.advance * flipSign,
        'Net Outstanding': r.netOutstanding * flipSign,
        'Days': r.daysOutstanding,
        'Ageing Bucket': r.ageingBucket,
        'Status': r.status,
        'Vouchers': r.vouchers.join(' | '),
        'Bill Types': r.billtypeMix.join(' | '),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${primary.replace(/\s+/g, '_')}_Billwise`);
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = primary === 'Sundry Debtors' ? 'Debtor' : 'Creditor';
      XLSX.writeFile(wb, `${slug}_Billwise_Ageing_${stamp}.xlsx`, { compression: true });
    } finally {
      setIsExporting(false);
    }
  };

  if (!store) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-3">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">True-FIFO bill knockoff requires the Tally Excel Export (ZIP) import.</p>
          <p className="text-xs mt-1">
            The trn_bill table that backs this view is only carried by the ZIP export. The
            voucher-date approximation below is the only ageing available with the live-loader import.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-blue-200 rounded-xl shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 bg-blue-600 text-white rounded">
            True FIFO
          </span>
          <div className="text-left">
            <h3 className="font-bold text-slate-900 text-sm">Bill-wise Outstanding (Tally <code>trn_bill</code>)</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {allRows.length} bills · {summary.length} parties · grand total ₹{formatINR(grandTotal)}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-5 space-y-5">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
              Include fully-settled bills
            </label>
            <button onClick={handleExport} disabled={isExporting || allRows.length === 0}
              className="ml-auto px-4 py-2 inline-flex items-center gap-2 text-sm font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 transition-colors">
              <Download size={15} />
              {isExporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>

          {/* Ageing summary by party */}
          {summary.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Party</th>
                    <th className="px-3 py-2 text-right">Bills</th>
                    <th className="px-3 py-2 text-right">0-30</th>
                    <th className="px-3 py-2 text-right">31-60</th>
                    <th className="px-3 py-2 text-right">61-90</th>
                    <th className="px-3 py-2 text-right">91-180</th>
                    <th className="px-3 py-2 text-right">181-365</th>
                    <th className="px-3 py-2 text-right">&gt;365</th>
                    <th className="px-3 py-2 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.party} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-medium text-slate-800">{s.party}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.billCount}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['0-30'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['31-60'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['61-90'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['91-180'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['181-365'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(s.buckets['>365'] * flipSign)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold">{formatINR(s.total * flipSign)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-900 text-white font-bold text-[11px]">
                  <tr>
                    <td className="px-3 py-2">{summary.length} parties</td>
                    <td className="px-3 py-2 text-right">{allRows.length}</td>
                    {BUCKETS.filter((b) => b !== 'unaged').map((b) => (
                      <td key={b} className="px-3 py-2 text-right tabular-nums">{formatINR(bucketTotals[b])}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Bill-level detail */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-semibold">
                <tr>
                  <th className="px-3 py-2 text-left">Bill Date</th>
                  <th className="px-3 py-2 text-left">Party</th>
                  <th className="px-3 py-2 text-left">Bill Name</th>
                  <th className="px-3 py-2 text-right">Original</th>
                  <th className="px-3 py-2 text-right">Knocked Off</th>
                  <th className="px-3 py-2 text-right">Net Outstanding</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2 text-left">Bucket</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allRows.map((r) => (
                  <tr key={`${r.party}|${r.billName}`} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 tabular-nums">{formatDDMMYYYY(r.billDate)}</td>
                    <td className="px-3 py-1.5 font-medium">{r.party}</td>
                    <td className="px-3 py-1.5">{r.billName}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(r.originalAmount * flipSign)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(r.knockoffAmount * flipSign)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">{formatINR(r.netOutstanding * flipSign)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.daysOutstanding}</td>
                    <td className="px-3 py-1.5">{r.ageingBucket}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_BADGE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {allRows.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-400">No bills found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Outstanding is computed by summing every <code>trn_bill</code> row for each (party, bill name)
            pair — original invoice as "New Ref" plus all receipts/payments as "Agst Ref" — so knockoff is
            deterministic, not FIFO-by-date approximation. "On Account" = unallocated payments;
            "Overpaid" = receipt &gt; invoice; "Open" = balance due. Ageing buckets are days from the
            earliest contributing voucher date to {asOf || 'today'}.
          </p>
        </div>
      )}
    </div>
  );
};

export default BillwiseAgeing;
