import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LedgerEntry, PartyMatrixProfile } from '../../types';
import { Download, Upload, FileJson, Search, Filter, CheckSquare, Square } from 'lucide-react';

interface Props {
  data: LedgerEntry[];
  externalProfile?: PartyMatrixProfile;
  onProfileUpdate?: (profile: PartyMatrixProfile) => void;
}

type Bucket = 'sales' | 'purchase' | 'expense' | 'tds' | 'gst' | 'rcm' | 'bank' | 'others';

interface PartyRow {
  partyName: string;
  totalSales: number;
  totalPurchase: number;
  totalExpenses: number;
  tdsDeducted: number;
  tdsExpensePct: number | null;
  gstAmount: number;
  gstSalesExpensePct: number | null;
  rcmAmount: number;
  bankAmount: number;
  others: number;
  debitTotal: number;
  creditTotal: number;
  movementNet: number;
  netBalance: number;
  balanceGap: number;
}

const toNum = (value: any): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const norm = (v: any) => String(v || '').trim().toLowerCase();
const sanitizeList = (v: any) =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x || '').trim()).filter(Boolean))) : [];
const money = (v: number) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? 'N/A'
    : `${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : `${v >= 0 ? '+' : ''}${money(v)}`);

const isMaster = (entry: LedgerEntry): boolean => {
  const raw = entry?.is_master_ledger;
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return false;
  if (['1', 'true', 'yes', 'y'].includes(t)) return true;
  if (['0', 'false', 'no', 'n'].includes(t)) return false;
  const n = Number(t);
  return Number.isFinite(n) ? n > 0 : false;
};

const voucherKey = (e: LedgerEntry): string => {
  const g = String(e.guid || '');
  if (g && !g.startsWith('ledger-master-')) return g.replace(/-\d+$/, '');
  return `${e.date}|${e.voucher_type}|${e.voucher_number}`;
};

const classifyPrimary = (e: LedgerEntry): Bucket | null => {
  const t = norm(e.TallyPrimary);
  if (t.includes('sale') || t.includes('income')) return 'sales';
  if (t.includes('purchase') || t.includes('inward')) return 'purchase';
  if (t.includes('expense')) return 'expense';
  return null;
};

const isBank = (e: LedgerEntry) => {
  const t = `${e.Ledger} ${e.TallyPrimary} ${e.TallyParent} ${e.Group}`.toLowerCase();
  return t.includes('bank') || t.includes('bank accounts');
};

const toDdMmYyyy = (dateIso: string) => {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const Selector: React.FC<{
  title: string;
  ledgers: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
}> = ({ title, ledgers, selected, onChange, suggestions }) => {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (!q ? ledgers : ledgers.filter((x) => x.toLowerCase().includes(q.toLowerCase()))), [ledgers, q]);
  const set = useMemo(() => new Set(selected), [selected]);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{title}</p>
        <span className="text-[11px] text-slate-500">{selected.length} selected</span>
      </div>
      <div className="flex gap-2">
        <button className="px-2 py-1 text-[11px] border rounded bg-indigo-50 border-indigo-300 text-indigo-700 font-bold" onClick={() => onChange(Array.from(new Set([...selected, ...suggestions])))}>Auto Suggest</button>
        <button className="px-2 py-1 text-[11px] border rounded bg-white border-slate-300 text-slate-600 font-bold" onClick={() => onChange([])}>Clear</button>
      </div>
      <div className="relative">
        <Search size={13} className="absolute left-2 top-2.5 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ledger" className="w-full pl-7 pr-2 py-2 text-xs border border-slate-300 rounded bg-white" />
      </div>
      <div className="max-h-44 overflow-auto bg-white border border-slate-200 rounded p-1">
        {shown.map((ledger) => {
          const chosen = set.has(ledger);
          return (
            <button key={ledger} className={`w-full px-2 py-1.5 text-left text-xs rounded flex items-center gap-2 ${chosen ? 'bg-indigo-50 border border-indigo-200 text-indigo-800' : 'hover:bg-slate-50'}`} onClick={() => onChange(chosen ? selected.filter((x) => x !== ledger) : [...selected, ledger])}>
              {chosen ? <CheckSquare size={12} /> : <Square size={12} />}
              <span className="truncate">{ledger}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PartyLedgerMatrix: React.FC<Props> = ({ data, externalProfile, onProfileUpdate }) => {
  const [partyQ, setPartyQ] = useState('');
  const [msg, setMsg] = useState('');
  const profileFileRef = useRef<HTMLInputElement | null>(null);
  const lastSentRef = useRef('');

  const { primaries, suggestedPrimaries, allLedgers, txRows, mstRows } = useMemo(() => {
    const p = new Set<string>();
    const l = new Set<string>();
    data.forEach((r) => {
      if (String(r.TallyPrimary || '').trim()) p.add(String(r.TallyPrimary).trim());
      if (String(r.Ledger || '').trim()) l.add(String(r.Ledger).trim());
    });
    const allP = Array.from(p).sort((a, b) => a.localeCompare(b));
    return {
      primaries: allP,
      suggestedPrimaries: allP.filter((x) => /(debtor|creditor)/i.test(x)),
      allLedgers: Array.from(l).sort((a, b) => a.localeCompare(b)),
      txRows: data.filter((r) => !isMaster(r)),
      mstRows: data.filter(isMaster),
    };
  }, [data]);

  const [selectedPrimary, setSelectedPrimary] = useState('');
  const [tdsLedgers, setTdsLedgers] = useState<string[]>([]);
  const [gstLedgers, setGstLedgers] = useState<string[]>([]);
  const [rcmLedgers, setRcmLedgers] = useState<string[]>([]);

  useEffect(() => {
    if (selectedPrimary) return;
    const fallback = externalProfile?.selectedPrimaryGroup || suggestedPrimaries[0] || primaries[0] || '';
    if (fallback) setSelectedPrimary(fallback);
  }, [externalProfile, primaries, selectedPrimary, suggestedPrimaries]);

  useEffect(() => {
    if (!externalProfile) return;
    const p: PartyMatrixProfile = {
      selectedPrimaryGroup: String(externalProfile.selectedPrimaryGroup || '').trim(),
      tdsLedgers: sanitizeList(externalProfile.tdsLedgers),
      gstLedgers: sanitizeList(externalProfile.gstLedgers),
      rcmLedgers: sanitizeList(externalProfile.rcmLedgers),
    };
    lastSentRef.current = JSON.stringify(p);
    setSelectedPrimary(p.selectedPrimaryGroup);
    setTdsLedgers(p.tdsLedgers);
    setGstLedgers(p.gstLedgers);
    setRcmLedgers(p.rcmLedgers);
  }, [externalProfile]);

  const effectivePrimary = useMemo(
    () => (primaries.includes(selectedPrimary) ? selectedPrimary : suggestedPrimaries[0] || primaries[0] || ''),
    [primaries, selectedPrimary, suggestedPrimaries]
  );

  useEffect(() => {
    if (!onProfileUpdate) return;
    const p: PartyMatrixProfile = {
      selectedPrimaryGroup: effectivePrimary || '',
      tdsLedgers: sanitizeList(tdsLedgers),
      gstLedgers: sanitizeList(gstLedgers),
      rcmLedgers: sanitizeList(rcmLedgers),
    };
    const s = JSON.stringify(p);
    if (s === lastSentRef.current) return;
    lastSentRef.current = s;
    onProfileUpdate(p);
  }, [effectivePrimary, gstLedgers, onProfileUpdate, rcmLedgers, tdsLedgers]);

  const suggestedTds = useMemo(() => allLedgers.filter((x) => /(tds|194)/i.test(x)), [allLedgers]);
  const suggestedGst = useMemo(() => allLedgers.filter((x) => /(igst|cgst|sgst|utgst|gst|cess)/i.test(x)), [allLedgers]);
  const suggestedRcm = useMemo(() => allLedgers.filter((x) => /(rcm|reverse charge)/i.test(x)), [allLedgers]);

  const analysis = useMemo(() => {
    if (!effectivePrimary) return { rows: [] as PartyRow[], partyUniverseCount: 0, unbalancedVoucherCount: 0 };
    const pNorm = norm(effectivePrimary);
    const tdsSet = new Set(tdsLedgers);
    const gstSet = new Set(gstLedgers);
    const rcmSet = new Set(rcmLedgers);

    const parties = new Set<string>();
    const closeRef = new Map<string, number>();
    [...mstRows, ...txRows].forEach((r) => {
      if (norm(r.TallyPrimary) !== pNorm) return;
      const party = String(r.Ledger || '').trim();
      if (!party) return;
      parties.add(party);
      const c = toNum(r.closing_balance);
      if (!closeRef.has(party) || (closeRef.get(party) === 0 && c !== 0)) closeRef.set(party, c);
    });

    const rows = new Map<string, PartyRow>();
    parties.forEach((party) => {
      rows.set(party, {
        partyName: party, totalSales: 0, totalPurchase: 0, totalExpenses: 0, tdsDeducted: 0, tdsExpensePct: null,
        gstAmount: 0, gstSalesExpensePct: null, rcmAmount: 0, bankAmount: 0, others: 0,
        debitTotal: 0, creditTotal: 0, movementNet: 0, netBalance: closeRef.get(party) ?? 0, balanceGap: 0,
      });
    });

    const vouchers = new Map<string, LedgerEntry[]>();
    txRows.forEach((r) => {
      const k = voucherKey(r);
      if (!vouchers.has(k)) vouchers.set(k, []);
      vouchers.get(k)!.push(r);
    });

    let unbalanced = 0;
    vouchers.forEach((entries) => {
      const vSum = entries.reduce((s, r) => s + toNum(r.amount), 0);
      if (Math.abs(vSum) > 0.01) unbalanced += 1;

      const partyEntries = entries.filter((r) => norm(r.TallyPrimary) === pNorm);
      if (partyEntries.length === 0) return;

      const partySigned = new Map<string, number>();
      partyEntries.forEach((e) => {
        const p = String(e.Ledger || '').trim();
        if (!p) return;
        partySigned.set(p, (partySigned.get(p) || 0) + toNum(e.amount));
      });
      const absTotal = Array.from(partySigned.values()).reduce((s, v) => s + Math.abs(v), 0);
      if (absTotal === 0) return;

      const partyGuids = new Set(partyEntries.map((e) => e.guid));
      const counterpart = entries.filter((e) => !partyGuids.has(e.guid));

      const buckets: Record<Bucket, number> = { sales: 0, purchase: 0, expense: 0, tds: 0, gst: 0, rcm: 0, bank: 0, others: 0 };
      counterpart.forEach((e) => {
        const amt = Math.abs(toNum(e.amount));
        const ledger = String(e.Ledger || '').trim();
        let b: Bucket = 'others';
        if (tdsSet.has(ledger)) b = 'tds';
        else if (gstSet.has(ledger)) b = 'gst';
        else if (rcmSet.has(ledger)) b = 'rcm';
        else {
          const byPrimary = classifyPrimary(e);
          if (byPrimary) b = byPrimary;
          else if (isBank(e)) b = 'bank';
        }
        buckets[b] += amt;
      });

      partySigned.forEach((signedAmt, party) => {
        const row = rows.get(party);
        if (!row) return;
        const absFlow = Math.abs(signedAmt);
        const share = absFlow / absTotal;
        if (signedAmt < 0) row.debitTotal += absFlow;
        if (signedAmt > 0) row.creditTotal += absFlow;
        row.totalSales += share * buckets.sales;
        row.totalPurchase += share * buckets.purchase;
        row.totalExpenses += share * buckets.expense;
        row.tdsDeducted += share * buckets.tds;
        row.gstAmount += share * buckets.gst;
        row.rcmAmount += share * buckets.rcm;
        row.bankAmount += share * buckets.bank;
        row.others += share * buckets.others;
      });
    });

    const out = Array.from(rows.values())
      .map((r) => {
        const movementNet = r.creditTotal - r.debitTotal;
        const netBalance = Number.isFinite(r.netBalance) ? r.netBalance : movementNet;
        const tdsExpensePct = r.totalExpenses !== 0 ? (r.tdsDeducted / r.totalExpenses) * 100 : null;
        const den = r.totalSales + r.totalExpenses;
        const gstSalesExpensePct = den !== 0 ? (r.gstAmount / den) * 100 : null;
        return { ...r, movementNet, netBalance, balanceGap: netBalance - movementNet, tdsExpensePct, gstSalesExpensePct };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName));

    return { rows: out, partyUniverseCount: parties.size, unbalancedVoucherCount: unbalanced };
  }, [effectivePrimary, gstLedgers, mstRows, rcmLedgers, tdsLedgers, txRows]);

  const filteredRows = useMemo(() => {
    const q = partyQ.trim().toLowerCase();
    return q ? analysis.rows.filter((r) => r.partyName.toLowerCase().includes(q)) : analysis.rows;
  }, [analysis.rows, partyQ]);

  const totals = useMemo(() => {
    const a = filteredRows.reduce(
      (s, r) => ({
        sales: s.sales + r.totalSales, purchase: s.purchase + r.totalPurchase, expenses: s.expenses + r.totalExpenses,
        tds: s.tds + r.tdsDeducted, gst: s.gst + r.gstAmount, rcm: s.rcm + r.rcmAmount, bank: s.bank + r.bankAmount,
        others: s.others + r.others, net: s.net + r.netBalance,
      }),
      { sales: 0, purchase: 0, expenses: 0, tds: 0, gst: 0, rcm: 0, bank: 0, others: 0, net: 0 }
    );
    const tdsExpensePct = a.expenses !== 0 ? (a.tds / a.expenses) * 100 : null;
    const gstSalesExpensePct = a.sales + a.expenses !== 0 ? (a.gst / (a.sales + a.expenses)) * 100 : null;
    return { ...a, tdsExpensePct, gstSalesExpensePct };
  }, [filteredRows]);

  const discrepancyCount = useMemo(() => filteredRows.filter((r) => Math.abs(r.balanceGap) > 1).length, [filteredRows]);
  const needsSelection = tdsLedgers.length === 0 || gstLedgers.length === 0 || rcmLedgers.length === 0;

  const exportProfile = () => {
    const payload = {
      profileType: 'party-matrix',
      version: 1,
      exportedOn: toDdMmYyyy(new Date().toISOString()),
      partyMatrixProfile: {
        selectedPrimaryGroup: effectivePrimary || '',
        tdsLedgers: sanitizeList(tdsLedgers),
        gstLedgers: sanitizeList(gstLedgers),
        rcmLedgers: sanitizeList(rcmLedgers),
      },
    };
    const uri = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
    const a = document.createElement('a');
    a.href = uri;
    a.download = `Party_Matrix_Profile_${toDdMmYyyy(new Date().toISOString()).replace(/\//g, '-')}.json`;
    a.click();
    setMsg('Profile exported successfully.');
    setTimeout(() => setMsg(''), 1800);
  };

  const importProfile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}'));
        const src = parsed?.partyMatrixProfile ? parsed.partyMatrixProfile : parsed;
        setSelectedPrimary(String(src?.selectedPrimaryGroup || '').trim());
        setTdsLedgers(sanitizeList(src?.tdsLedgers));
        setGstLedgers(sanitizeList(src?.gstLedgers));
        setRcmLedgers(sanitizeList(src?.rcmLedgers));
        setMsg('Profile imported successfully.');
      } catch {
        setMsg('Invalid profile file.');
      }
      setTimeout(() => setMsg(''), 2200);
    };
    r.readAsText(file);
    e.target.value = '';
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx-js-style');
      const stamp = toDdMmYyyy(new Date().toISOString()).replace(/\//g, '-');
      const aoa: any[][] = [
        ['Party Ledger Matrix'],
        [`Selected Tally Primary Group: ${effectivePrimary || 'N/A'}`],
        ['Net Balance Convention: Credit is positive (+), Debit is negative (-).'],
        [''],
        ['Party/Ledger Name', 'Total Sales', 'Total Purchase', 'Total Expenses', 'TDS Deducted', 'TDS / Expense %', 'GST', 'GST / (Sales + Expense) %', 'RCM', 'Bank', 'Others/Adjustments', 'Net Balance (+Cr / -Dr)'],
      ];
      filteredRows.forEach((r) => aoa.push([r.partyName, r.totalSales, r.totalPurchase, r.totalExpenses, r.tdsDeducted, r.tdsExpensePct, r.gstAmount, r.gstSalesExpensePct, r.rcmAmount, r.bankAmount, r.others, r.netBalance]));
      aoa.push(['TOTAL', totals.sales, totals.purchase, totals.expenses, totals.tds, totals.tdsExpensePct, totals.gst, totals.gstSalesExpensePct, totals.rcm, totals.bank, totals.others, totals.net]);
      aoa.push([]);
      aoa.push(['Observations']);
      aoa.push([`Parties in selected group: ${analysis.partyUniverseCount}`]);
      aoa.push([`Parties in current filter: ${filteredRows.length}`]);
      aoa.push([`Vouchers with debit/credit imbalance: ${analysis.unbalancedVoucherCount}`]);
      aoa.push([`Parties with movement vs closing gap > 1.00: ${discrepancyCount}`]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 20 }];
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
        { s: { r: 8 + filteredRows.length, c: 0 }, e: { r: 8 + filteredRows.length, c: 11 } },
      ];
      ws['!autofilter'] = { ref: 'A5:L5' };

      const border = { top: { style: 'thin', color: { rgb: 'CBD5E1' } }, right: { style: 'thin', color: { rgb: 'CBD5E1' } }, bottom: { style: 'thin', color: { rgb: 'CBD5E1' } }, left: { style: 'thin', color: { rgb: 'CBD5E1' } } };
      const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
      const paint = (r: number, c: number, style: any) => { const x = cell(r, c); if (x) x.s = style; };

      for (let c = 0; c <= 11; c++) paint(0, c, { font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: 'center' }, border });
      for (let r = 1; r <= 2; r++) for (let c = 0; c <= 11; c++) paint(r, c, { font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '1E40AF' } }, fill: { fgColor: { rgb: 'EFF6FF' } }, alignment: { horizontal: 'left' }, border });
      for (let c = 0; c <= 11; c++) paint(4, c, { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '111827' } }, alignment: { horizontal: 'center' }, border });

      const firstData = 5;
      const lastData = firstData + filteredRows.length - 1;
      for (let r = firstData; r <= lastData; r++) {
        for (let c = 0; c <= 11; c++) {
          const style: any = {
            font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' }, bold: c === 0 },
            fill: { fgColor: { rgb: r % 2 === 0 ? 'FFFFFF' : 'F8FAFC' } },
            alignment: { horizontal: c === 0 ? 'left' : 'right' },
            border,
          };
          if (c > 0) style.numFmt = '#,##0.00';
          paint(r, c, style);
        }
      }

      const totalRow = firstData + filteredRows.length;
      for (let c = 0; c <= 11; c++) paint(totalRow, c, { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0F766E' } }, alignment: { horizontal: c === 0 ? 'left' : 'right' }, border, numFmt: c > 0 ? '#,##0.00' : undefined });

      const obsRow = totalRow + 2;
      for (let c = 0; c <= 11; c++) paint(obsRow, c, { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '92400E' } }, fill: { fgColor: { rgb: 'FEF3C7' } }, alignment: { horizontal: 'left' }, border });
      for (let r = obsRow + 1; r <= obsRow + 4; r++) for (let c = 0; c <= 11; c++) paint(r, c, { font: { name: 'Calibri', sz: 10, color: { rgb: '78350F' } }, fill: { fgColor: { rgb: 'FFFBEB' } }, alignment: { horizontal: 'left' }, border });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Party Matrix');
      XLSX.writeFile(wb, `Party_Ledger_Matrix_${stamp}.xlsx`, { compression: true });
    } catch (err) {
      console.error(err);
      window.alert('Excel export failed. Please retry.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Module</p>
            <h3 className="text-xl font-black text-slate-900">Party Ledger Matrix</h3>
            <p className="text-sm text-slate-500 mt-1">Net Balance shown as <span className="font-semibold">Credit positive (+)</span> and <span className="font-semibold">Debit negative (-)</span>.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportProfile} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-sm font-bold"><FileJson size={14} /> Export Profile</button>
            <button onClick={() => profileFileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-bold"><Upload size={14} /> Import Profile</button>
            <button onClick={exportExcel} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700"><Download size={15} /> Export Beautiful Excel</button>
            <input ref={profileFileRef} type="file" className="hidden" accept=".json" onChange={importProfile} />
          </div>
        </div>

        {msg && <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">{msg}</div>}
        {needsSelection && <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">Select TDS, GST and RCM ledgers for accurate classification.</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Select Tally Primary Group</label>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-400" />
              <select value={effectivePrimary} onChange={(e) => setSelectedPrimary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                {primaries.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <Selector title="TDS Ledgers (User Selected)" ledgers={allLedgers} selected={tdsLedgers} onChange={setTdsLedgers} suggestions={suggestedTds} />
          <Selector title="GST Ledgers (User Selected)" ledgers={allLedgers} selected={gstLedgers} onChange={setGstLedgers} suggestions={suggestedGst} />
          <Selector title="RCM Ledgers (User Selected)" ledgers={allLedgers} selected={rcmLedgers} onChange={setRcmLedgers} suggestions={suggestedRcm} />

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Search Party</p>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-2.5 text-slate-400" />
              <input value={partyQ} onChange={(e) => setPartyQ(e.target.value)} placeholder="Search party/ledger" className="w-full pl-7 pr-2 py-2 text-xs border border-slate-300 rounded-lg bg-white" />
            </div>
            <p className="text-[11px] text-slate-500">Rows: {filteredRows.length}</p>
            <p className="text-[11px] text-slate-500">Group Parties: {analysis.partyUniverseCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Party/Ledger Name</th>
              <th className="px-4 py-3 text-right">Total Sales</th>
              <th className="px-4 py-3 text-right">Total Purchase</th>
              <th className="px-4 py-3 text-right">Total Expenses</th>
              <th className="px-4 py-3 text-right">TDS Deducted</th>
              <th className="px-4 py-3 text-right">TDS / Expense %</th>
              <th className="px-4 py-3 text-right">GST</th>
              <th className="px-4 py-3 text-right">GST / (Sales + Expense) %</th>
              <th className="px-4 py-3 text-right">RCM</th>
              <th className="px-4 py-3 text-right">Bank</th>
              <th className="px-4 py-3 text-right">Others/Adjustments</th>
              <th className="px-4 py-3 text-right">Net Balance (+Cr / -Dr)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.map((r) => (
              <tr key={r.partyName} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{r.partyName}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.totalSales)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.totalPurchase)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.totalExpenses)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.tdsDeducted)}</td>
                <td className="px-4 py-3 text-right font-mono">{pct(r.tdsExpensePct)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.gstAmount)}</td>
                <td className="px-4 py-3 text-right font-mono">{pct(r.gstSalesExpensePct)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.rcmAmount)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.bankAmount)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.others)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{signed(r.netBalance)}</td>
              </tr>
            ))}
            {filteredRows.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={12}>No parties found for selected group/filter.</td></tr>}
          </tbody>
          <tfoot className="bg-slate-900 text-white text-sm font-bold">
            <tr>
              <td className="px-4 py-3">Totals</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.sales)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.purchase)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.expenses)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.tds)}</td>
              <td className="px-4 py-3 text-right font-mono">{pct(totals.tdsExpensePct)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.gst)}</td>
              <td className="px-4 py-3 text-right font-mono">{pct(totals.gstSalesExpensePct)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.rcm)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.bank)}</td>
              <td className="px-4 py-3 text-right font-mono">{money(totals.others)}</td>
              <td className="px-4 py-3 text-right font-mono">{signed(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
        <p className="font-bold mb-2">Summary / Observations</p>
        <p>Selected Tally Primary Group: <span className="font-semibold">{effectivePrimary || 'N/A'}</span></p>
        <p>Vouchers with debit/credit imbalance: <span className="font-semibold">{analysis.unbalancedVoucherCount}</span></p>
        <p>Parties where movement and net balance differ by more than 1.00: <span className="font-semibold">{discrepancyCount}</span></p>
      </div>
    </div>
  );
};

export default PartyLedgerMatrix;

