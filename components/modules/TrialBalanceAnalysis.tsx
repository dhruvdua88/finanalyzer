import React, { useEffect, useMemo, useState } from 'react';
import { LedgerEntry } from '../../types';
import { Download, Search, Layers, ChevronDown, ChevronRight } from 'lucide-react';

interface TrialBalanceAnalysisProps {
  data: LedgerEntry[];
}

interface TrialBalanceRow {
  ledger: string;
  primary: string;
  parent: string;
  opening: number;
  duringDr: number;
  duringCr: number;
  closing: number;
}

interface GroupNode {
  rows: TrialBalanceRow[];
  opening: number;
  duringDr: number;
  duringCr: number;
  closing: number;
}

interface DrCrTotals {
  openingDr: number;
  openingCr: number;
  duringDr: number;
  duringCr: number;
  closingDr: number;
  closingCr: number;
}

const toNumber = (value: any): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const splitDrCr = (value: number) => ({
  dr: value < 0 ? Math.abs(value) : 0,
  cr: value > 0 ? value : 0,
});

const formatAmount = (value: number) =>
  value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const BALANCE_TOLERANCE = 0.005;

const summarizeDrCrTotals = (rows: TrialBalanceRow[]): DrCrTotals => {
  return rows.reduce(
    (acc, row) => {
      const opening = splitDrCr(row.opening);
      const closing = splitDrCr(row.closing);
      acc.openingDr += opening.dr;
      acc.openingCr += opening.cr;
      acc.duringDr += row.duringDr;
      acc.duringCr += row.duringCr;
      acc.closingDr += closing.dr;
      acc.closingCr += closing.cr;
      return acc;
    },
    {
      openingDr: 0,
      openingCr: 0,
      duringDr: 0,
      duringCr: 0,
      closingDr: 0,
      closingCr: 0,
    }
  );
};

const formatDdMmYyyy = (isoDate: string) => {
  if (!isoDate) return '';
  const safe = isoDate.trim().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
    const [yyyy, mm, dd] = safe.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  const parsed = new Date(safe);
  if (Number.isNaN(parsed.getTime())) return safe;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = parsed.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatNowDdMmYyyyHm = (date: Date) => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

const isMasterLedgerEntry = (entry: LedgerEntry): boolean => {
  const raw = entry?.is_master_ledger;
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const text = String(raw).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'n') return false;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed > 0 : false;
};

const TrialBalanceAnalysis: React.FC<TrialBalanceAnalysisProps> = ({ data }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState('all');
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [collapsedPrimary, setCollapsedPrimary] = useState<Record<string, boolean>>({});
  const [collapsedParent, setCollapsedParent] = useState<Record<string, boolean>>({});

  const { rows, periodFrom, periodTo } = useMemo(() => {
    const ledgerMap = new Map<string, TrialBalanceRow>();
    let minDate = '';
    let maxDate = '';

    data.forEach((entry) => {
      const ledger = (entry.Ledger || '').trim();
      if (!ledger) return;
      const isMaster = isMasterLedgerEntry(entry);

      const primary = (entry.TallyPrimary || 'Unclassified').trim() || 'Unclassified';
      const parent = (entry.TallyParent || entry.Group || 'Ungrouped').trim() || 'Ungrouped';

      if (!ledgerMap.has(ledger)) {
        ledgerMap.set(ledger, {
          ledger,
          primary,
          parent,
          opening: toNumber(entry.opening_balance),
          duringDr: 0,
          duringCr: 0,
          closing: toNumber(entry.closing_balance),
        });
      }

      const row = ledgerMap.get(ledger)!;
      const opening = toNumber(entry.opening_balance);
      const closing = toNumber(entry.closing_balance);
      if (isMaster) {
        // Master rows are authoritative for opening/closing balances.
        row.opening = opening;
        row.closing = closing;
      } else {
        const amount = toNumber(entry.amount);
        if (amount < 0) row.duringDr += Math.abs(amount);
        if (amount > 0) row.duringCr += amount;
        if (row.opening === 0 && opening !== 0) row.opening = opening;
        if (row.closing === 0 && closing !== 0) row.closing = closing;
      }
      if (!row.primary && primary) row.primary = primary;
      if (!row.parent && parent) row.parent = parent;

      if (!isMaster && entry.date) {
        if (!minDate || entry.date < minDate) minDate = entry.date;
        if (!maxDate || entry.date > maxDate) maxDate = entry.date;
      }
    });

    const rows = Array.from(ledgerMap.values()).sort((a, b) =>
      `${a.primary}|${a.parent}|${a.ledger}`.localeCompare(`${b.primary}|${b.parent}|${b.ledger}`)
    );
    return { rows, periodFrom: minDate, periodTo: maxDate };
  }, [data]);

  const primaryOptions = useMemo(
    () => ['all', ...Array.from(new Set(rows.map((r) => r.primary))).sort()],
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        !search ||
        row.ledger.toLowerCase().includes(search) ||
        row.parent.toLowerCase().includes(search) ||
        row.primary.toLowerCase().includes(search);
      const matchesPrimary = primaryFilter === 'all' || row.primary === primaryFilter;
      const hasMovement = showOnlyActive ? row.duringDr !== 0 || row.duringCr !== 0 : true;
      return matchesSearch && matchesPrimary && hasMovement;
    });
  }, [rows, searchTerm, primaryFilter, showOnlyActive]);

  const grouped = useMemo(() => {
    const primaryMap = new Map<string, { totals: GroupNode; parents: Map<string, GroupNode> }>();

    filteredRows.forEach((row) => {
      if (!primaryMap.has(row.primary)) {
        primaryMap.set(row.primary, {
          totals: { rows: [], opening: 0, duringDr: 0, duringCr: 0, closing: 0 },
          parents: new Map<string, GroupNode>(),
        });
      }

      const primaryGroup = primaryMap.get(row.primary)!;
      if (!primaryGroup.parents.has(row.parent)) {
        primaryGroup.parents.set(row.parent, { rows: [], opening: 0, duringDr: 0, duringCr: 0, closing: 0 });
      }

      const parentGroup = primaryGroup.parents.get(row.parent)!;
      parentGroup.rows.push(row);
      parentGroup.opening += row.opening;
      parentGroup.duringDr += row.duringDr;
      parentGroup.duringCr += row.duringCr;
      parentGroup.closing += row.closing;

      primaryGroup.totals.opening += row.opening;
      primaryGroup.totals.duringDr += row.duringDr;
      primaryGroup.totals.duringCr += row.duringCr;
      primaryGroup.totals.closing += row.closing;
    });

    return Array.from(primaryMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([primary, group]) => ({
        primary,
        totals: group.totals,
        parents: Array.from(group.parents.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([parent, node]) => ({ parent, ...node })),
      }));
  }, [filteredRows]);

  const grandTotals = useMemo(() => summarizeDrCrTotals(filteredRows), [filteredRows]);

  useEffect(() => {
    setCollapsedPrimary((prev) => {
      const next: Record<string, boolean> = {};
      grouped.forEach((block) => {
        next[block.primary] = prev[block.primary] ?? false;
      });
      return next;
    });

    setCollapsedParent((prev) => {
      const next: Record<string, boolean> = {};
      grouped.forEach((primaryBlock) => {
        primaryBlock.parents.forEach((parentBlock) => {
          const key = `${primaryBlock.primary}::${parentBlock.parent}`;
          next[key] = prev[key] ?? false;
        });
      });
      return next;
    });
  }, [grouped]);

  const collapseAll = () => {
    const nextPrimary: Record<string, boolean> = {};
    const nextParent: Record<string, boolean> = {};
    grouped.forEach((primaryBlock) => {
      nextPrimary[primaryBlock.primary] = true;
      primaryBlock.parents.forEach((parentBlock) => {
        nextParent[`${primaryBlock.primary}::${parentBlock.parent}`] = true;
      });
    });
    setCollapsedPrimary(nextPrimary);
    setCollapsedParent(nextParent);
  };

  const expandAll = () => {
    const nextPrimary: Record<string, boolean> = {};
    const nextParent: Record<string, boolean> = {};
    grouped.forEach((primaryBlock) => {
      nextPrimary[primaryBlock.primary] = false;
      primaryBlock.parents.forEach((parentBlock) => {
        nextParent[`${primaryBlock.primary}::${parentBlock.parent}`] = false;
      });
    });
    setCollapsedPrimary(nextPrimary);
    setCollapsedParent(nextParent);
  };

  const exportTrialBalance = async () => {
    try {
      const XLSX = await import('xlsx-js-style');
      const openingGrand = { dr: grandTotals.openingDr, cr: grandTotals.openingCr };
      const closingGrand = { dr: grandTotals.closingDr, cr: grandTotals.closingCr };
      const periodLabel =
        periodFrom && periodTo ? `${formatDdMmYyyy(periodFrom)} to ${formatDdMmYyyy(periodTo)}` : 'N/A';

      const aoa: any[][] = [];
      const rowKind: Record<number, 'title' | 'meta' | 'summaryHeader' | 'summaryData' | 'header' | 'primary' | 'parent' | 'ledger' | 'parentSubtotal' | 'primarySubtotal' | 'grand' | 'blank'> = {};
      const rowLevel: Record<number, number> = {};

      const pushRow = (values: any[], kind: typeof rowKind[number], level?: number) => {
        aoa.push(values);
        const rowNo = aoa.length;
        rowKind[rowNo] = kind;
        if (typeof level === 'number') rowLevel[rowNo] = level;
        return rowNo;
      };

      const now = new Date();
      pushRow(['Trial Balance - Grouped by TallyPrimary and TallyParent', '', '', '', '', '', '', '', '', ''], 'title');
      pushRow(['Grand Totals Summary', '', '', '', 'Opening Dr', 'Opening Cr', 'During Year Dr', 'During Year Cr', 'Closing Dr', 'Closing Cr'], 'summaryHeader');
      pushRow(['All Filtered Groups', '', '', '', openingGrand.dr, openingGrand.cr, grandTotals.duringDr, grandTotals.duringCr, closingGrand.dr, closingGrand.cr], 'summaryData');
      pushRow(['', '', '', '', '', '', '', '', '', ''], 'blank');
      pushRow([`Data Period: ${periodLabel}`, '', '', '', '', '', '', '', '', ''], 'meta');
      pushRow([`Generated On: ${formatNowDdMmYyyyHm(now)}`, '', '', '', '', '', '', '', '', ''], 'meta');
      pushRow(['', '', '', '', '', '', '', '', '', ''], 'blank');
      const detailHeaderRow = pushRow(
        ['Level', 'Tally Primary', 'Tally Parent', 'Ledger', 'Opening Dr', 'Opening Cr', 'During Year Dr', 'During Year Cr', 'Closing Dr', 'Closing Cr'],
        'header'
      );

      grouped.forEach((primaryBlock) => {
        const primaryRows = primaryBlock.parents.flatMap((parentBlock) => parentBlock.rows);
        const primaryTotals = summarizeDrCrTotals(primaryRows);
        pushRow(
          [
            'PRIMARY',
            primaryBlock.primary,
            '',
            '',
            primaryTotals.openingDr,
            primaryTotals.openingCr,
            primaryTotals.duringDr,
            primaryTotals.duringCr,
            primaryTotals.closingDr,
            primaryTotals.closingCr,
          ],
          'primary',
          0
        );

        primaryBlock.parents.forEach((parentBlock) => {
          const parentTotals = summarizeDrCrTotals(parentBlock.rows);
          pushRow(
            [
              'PARENT',
              primaryBlock.primary,
              parentBlock.parent,
              '',
              parentTotals.openingDr,
              parentTotals.openingCr,
              parentTotals.duringDr,
              parentTotals.duringCr,
              parentTotals.closingDr,
              parentTotals.closingCr,
            ],
            'parent',
            1
          );

          parentBlock.rows.forEach((row) => {
            const opening = splitDrCr(row.opening);
            const closing = splitDrCr(row.closing);
            pushRow(
              ['LEDGER', row.primary, row.parent, row.ledger, opening.dr, opening.cr, row.duringDr, row.duringCr, closing.dr, closing.cr],
              'ledger',
              2
            );
          });

          pushRow(
            [
              'PARENT SUBTOTAL',
              primaryBlock.primary,
              parentBlock.parent,
              '',
              parentTotals.openingDr,
              parentTotals.openingCr,
              parentTotals.duringDr,
              parentTotals.duringCr,
              parentTotals.closingDr,
              parentTotals.closingCr,
            ],
            'parentSubtotal',
            1
          );
        });

        pushRow(
          [
            'PRIMARY SUBTOTAL',
            primaryBlock.primary,
            '',
            '',
            primaryTotals.openingDr,
            primaryTotals.openingCr,
            primaryTotals.duringDr,
            primaryTotals.duringCr,
            primaryTotals.closingDr,
            primaryTotals.closingCr,
          ],
          'primarySubtotal',
          0
        );
      });

      pushRow(['', '', '', '', '', '', '', '', '', ''], 'blank');
      pushRow(['GRAND TOTAL', '', '', '', openingGrand.dr, openingGrand.cr, grandTotals.duringDr, grandTotals.duringCr, closingGrand.dr, closingGrand.cr], 'grand');

      const worksheet = XLSX.utils.aoa_to_sheet(aoa);

      worksheet['!cols'] = [
        { wch: 16 },
        { wch: 28 },
        { wch: 28 },
        { wch: 36 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
      ];

      worksheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
        { s: { r: 4, c: 0 }, e: { r: 4, c: 9 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 9 } },
      ];

      worksheet['!autofilter'] = { ref: `A${detailHeaderRow}:J${detailHeaderRow}` };
      worksheet['!outline'] = { summaryBelow: true };

      const rowsMeta: any[] = [];
      for (let rowNo = 1; rowNo <= aoa.length; rowNo++) {
        if (rowLevel[rowNo] !== undefined) rowsMeta[rowNo - 1] = { level: rowLevel[rowNo] };
      }
      worksheet['!rows'] = rowsMeta;

      const border = {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      };

      const rowStyleByKind: Record<string, any> = {
        title: { fill: { fgColor: { rgb: 'F8FAFC' } }, font: { name: 'Calibri', sz: 15, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        meta: { fill: { fgColor: { rgb: 'FFFFFF' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '334155' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        summaryHeader: { fill: { fgColor: { rgb: 'E5E7EB' } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        summaryData: { fill: { fgColor: { rgb: 'FFFFFF' } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        header: { fill: { fgColor: { rgb: 'F1F5F9' } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        primary: { fill: { fgColor: { rgb: 'F8FAFC' } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        parent: { fill: { fgColor: { rgb: 'FFFFFF' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        ledger: { fill: { fgColor: { rgb: 'FFFFFF' } }, font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        parentSubtotal: { fill: { fgColor: { rgb: 'F3F4F6' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        primarySubtotal: { fill: { fgColor: { rgb: 'E5E7EB' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        grand: { fill: { fgColor: { rgb: 'E2E8F0' } }, font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        blank: { fill: { fgColor: { rgb: 'FFFFFF' } }, font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } },
      };

      for (let r = 0; r < aoa.length; r++) {
        const kind = rowKind[r + 1] || 'ledger';
        for (let c = 0; c < 10; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!worksheet[ref]) continue;

          const isNumber = c >= 4 && typeof worksheet[ref].v === 'number';
          const styleBase = rowStyleByKind[kind] || rowStyleByKind.ledger;
          const style: any = {
            ...styleBase,
            border,
          };

          if (isNumber) {
            style.numFmt = '#,##0.00';
            style.alignment = { ...(style.alignment || {}), horizontal: 'right' };
          }

          worksheet[ref].s = style;
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Trial Balance');

      const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
      XLSX.writeFile(workbook, `Trial_Balance_${stamp}.xlsx`, { compression: true });
    } catch (error) {
      console.error(error);
      window.alert('Unable to export Trial Balance Excel. Please retry.');
    }
  };

  const openingTotals = { dr: grandTotals.openingDr, cr: grandTotals.openingCr };
  const closingTotals = { dr: grandTotals.closingDr, cr: grandTotals.closingCr };
  const openingDifference = Math.abs(openingTotals.dr - openingTotals.cr);
  const closingDifference = Math.abs(closingTotals.dr - closingTotals.cr);
  const hasOpeningDifference = openingDifference > BALANCE_TOLERANCE;
  const hasClosingDifference = closingDifference > BALANCE_TOLERANCE;
  const hasAnyDifference = hasOpeningDifference || hasClosingDifference;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Ledgers</p>
          <p className="text-3xl font-black text-slate-900 mt-1">{filteredRows.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Opening</p>
          <p className="text-sm font-black text-red-600 mt-1">Dr {formatAmount(openingTotals.dr)}</p>
          <p className="text-sm font-black text-green-700 mt-0.5">Cr {formatAmount(openingTotals.cr)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">During Year</p>
          <p className="text-sm font-black text-red-600 mt-1">Dr {formatAmount(grandTotals.duringDr)}</p>
          <p className="text-sm font-black text-green-700 mt-0.5">Cr {formatAmount(grandTotals.duringCr)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Closing</p>
          <p className="text-sm font-black text-red-600 mt-1">Dr {formatAmount(closingTotals.dr)}</p>
          <p className="text-sm font-black text-green-700 mt-0.5">Cr {formatAmount(closingTotals.cr)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Data Period</p>
          <p className="text-sm font-bold text-slate-800 mt-2">
            {periodFrom && periodTo ? `${formatDdMmYyyy(periodFrom)} to ${formatDdMmYyyy(periodTo)}` : 'N/A'}
          </p>
        </div>
      </div>

      <div
        className={`rounded-xl border px-5 py-3 ${
          hasAnyDifference ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        <p className={`text-sm font-black ${hasAnyDifference ? 'text-rose-800' : 'text-emerald-800'}`}>
          {hasAnyDifference
            ? 'Trial Balance Difference Detected (Opening/Closing)'
            : 'Opening and Closing balances are matched (Dr = Cr)'}
        </p>
        <div className={`mt-1 text-xs font-semibold ${hasAnyDifference ? 'text-rose-700' : 'text-emerald-700'}`}>
          <span>Opening Difference: {formatAmount(openingDifference)}</span>
          <span className="mx-2">|</span>
          <span>Closing Difference: {formatAmount(closingDifference)}</span>
        </div>
      </div>

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search ledger, parent, or primary..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            value={primaryFilter}
            onChange={(e) => setPrimaryFilter(e.target.value)}
          >
            {primaryOptions.map((option) => (
              <option key={option} value={option}>
            {option === 'all' ? 'All Primary Groups' : option}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowOnlyActive((v) => !v)}
            className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
              showOnlyActive
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                : 'bg-white border-slate-300 text-slate-600'
            }`}
          >
            {showOnlyActive ? 'Only Active: ON' : 'Only Active: OFF'}
          </button>
          <button
            onClick={expandAll}
            className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
          >
            Collapse All
          </button>
          <button
            onClick={exportTrialBalance}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 flex items-center gap-2"
          >
            <Download size={16} />
            Export Excel
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Source filter: accounting vouchers only (`is_accounting_voucher = 1`).
        </p>
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white p-16 rounded-xl border border-slate-200 shadow-sm text-center text-slate-400">
          No trial balance rows match current filters.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((primaryBlock) => {
            const primaryTotals = summarizeDrCrTotals(primaryBlock.parents.flatMap((parentBlock) => parentBlock.rows));
            const primaryKey = primaryBlock.primary;
            const primaryIsCollapsed = collapsedPrimary[primaryKey] ?? false;
            const primaryLedgerCount = primaryBlock.parents.reduce((acc, parentBlock) => acc + parentBlock.rows.length, 0);
            return (
              <div key={primaryBlock.primary} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 bg-indigo-50 border-b border-indigo-100 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <button
                      onClick={() =>
                        setCollapsedPrimary((prev) => ({
                          ...prev,
                          [primaryKey]: !primaryIsCollapsed,
                        }))
                      }
                      className="flex items-center gap-2 text-left"
                    >
                      {primaryIsCollapsed ? (
                        <ChevronRight size={16} className="text-indigo-600" />
                      ) : (
                        <ChevronDown size={16} className="text-indigo-600" />
                      )}
                      <Layers size={16} className="text-indigo-600" />
                      <h3 className="text-lg font-black text-indigo-900">{primaryBlock.primary}</h3>
                    </button>
                    <p className="text-xs font-semibold text-indigo-700">
                      {primaryBlock.parents.length} parents | {primaryLedgerCount} ledgers
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] text-[11px]">
                      <thead className="text-indigo-700 uppercase tracking-wide">
                        <tr>
                          <th className="px-2 py-1 text-right">Opening Dr</th>
                          <th className="px-2 py-1 text-right">Opening Cr</th>
                          <th className="px-2 py-1 text-right">During Dr</th>
                          <th className="px-2 py-1 text-right">During Cr</th>
                          <th className="px-2 py-1 text-right">Closing Dr</th>
                          <th className="px-2 py-1 text-right">Closing Cr</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="font-black text-indigo-900">
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.openingDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.openingCr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.duringDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.duringCr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.closingDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.closingCr)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {!primaryIsCollapsed &&
                  primaryBlock.parents.map((parentBlock) => {
                  const parentTotals = summarizeDrCrTotals(parentBlock.rows);
                  const parentKey = `${primaryBlock.primary}::${parentBlock.parent}`;
                  const parentIsCollapsed = collapsedParent[parentKey] ?? false;
                  return (
                    <div key={`${primaryBlock.primary}-${parentBlock.parent}`} className="border-b border-slate-100 last:border-b-0">
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 space-y-2">
                        <div className="flex justify-between items-center gap-3 flex-wrap">
                          <button
                            onClick={() =>
                              setCollapsedParent((prev) => ({
                                ...prev,
                                [parentKey]: !parentIsCollapsed,
                              }))
                            }
                            className="flex items-center gap-2 text-left"
                          >
                            {parentIsCollapsed ? (
                              <ChevronRight size={15} className="text-slate-500" />
                            ) : (
                              <ChevronDown size={15} className="text-slate-500" />
                            )}
                            <p className="text-sm font-bold text-slate-800">{parentBlock.parent}</p>
                          </button>
                          <p className="text-[11px] font-semibold text-slate-500">{parentBlock.rows.length} ledgers</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-[760px] text-[11px]">
                            <thead className="text-slate-500 uppercase tracking-wide">
                              <tr>
                                <th className="px-2 py-1 text-right">Opening Dr</th>
                                <th className="px-2 py-1 text-right">Opening Cr</th>
                                <th className="px-2 py-1 text-right">During Dr</th>
                                <th className="px-2 py-1 text-right">During Cr</th>
                                <th className="px-2 py-1 text-right">Closing Dr</th>
                                <th className="px-2 py-1 text-right">Closing Cr</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="font-bold text-slate-700">
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.openingDr)}</td>
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.openingCr)}</td>
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.duringDr)}</td>
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.duringCr)}</td>
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.closingDr)}</td>
                                <td className="px-2 py-1 text-right">{formatAmount(parentTotals.closingCr)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {!parentIsCollapsed && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-white text-slate-500 text-[11px] font-bold uppercase border-b border-slate-100">
                              <tr>
                                <th className="px-4 py-3 text-left">Ledger</th>
                                <th className="px-4 py-3 text-right">Opening Dr</th>
                                <th className="px-4 py-3 text-right">Opening Cr</th>
                                <th className="px-4 py-3 text-right">During Year Dr</th>
                                <th className="px-4 py-3 text-right">During Year Cr</th>
                                <th className="px-4 py-3 text-right">Closing Dr</th>
                                <th className="px-4 py-3 text-right">Closing Cr</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {parentBlock.rows.map((row) => {
                                const opening = splitDrCr(row.opening);
                                const closing = splitDrCr(row.closing);
                                return (
                                  <tr key={`${row.primary}-${row.parent}-${row.ledger}`} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-semibold text-slate-800">{row.ledger}</td>
                                    <td className="px-4 py-3 text-right font-mono">{opening.dr ? formatAmount(opening.dr) : '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono">{opening.cr ? formatAmount(opening.cr) : '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono text-red-700">
                                      {row.duringDr ? formatAmount(row.duringDr) : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-green-700">
                                      {row.duringCr ? formatAmount(row.duringCr) : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">{closing.dr ? formatAmount(closing.dr) : '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono">{closing.cr ? formatAmount(closing.cr) : '-'}</td>
                                  </tr>
                                );
                              })}
                              <tr className="bg-slate-50 font-bold text-slate-700">
                                <td className="px-4 py-3">Parent Total</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.openingDr ? formatAmount(parentTotals.openingDr) : '-'}</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.openingCr ? formatAmount(parentTotals.openingCr) : '-'}</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.duringDr ? formatAmount(parentTotals.duringDr) : '-'}</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.duringCr ? formatAmount(parentTotals.duringCr) : '-'}</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.closingDr ? formatAmount(parentTotals.closingDr) : '-'}</td>
                                <td className="px-4 py-3 text-right font-mono">{parentTotals.closingCr ? formatAmount(parentTotals.closingCr) : '-'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="px-5 py-3 bg-indigo-100 border-t border-indigo-200 space-y-2">
                  <p className="text-sm font-black text-indigo-900">Primary Total</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] text-[11px]">
                      <thead className="text-indigo-700 uppercase tracking-wide">
                        <tr>
                          <th className="px-2 py-1 text-right">Opening Dr</th>
                          <th className="px-2 py-1 text-right">Opening Cr</th>
                          <th className="px-2 py-1 text-right">During Dr</th>
                          <th className="px-2 py-1 text-right">During Cr</th>
                          <th className="px-2 py-1 text-right">Closing Dr</th>
                          <th className="px-2 py-1 text-right">Closing Cr</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="font-black text-indigo-900">
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.openingDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.openingCr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.duringDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.duringCr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.closingDr)}</td>
                          <td className="px-2 py-1 text-right">{formatAmount(primaryTotals.closingCr)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrialBalanceAnalysis;
