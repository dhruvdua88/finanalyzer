import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, FileUp, RefreshCcw } from 'lucide-react';
import {
  compareTallySourceFile,
  TsfComparableRow,
  TsfComparePayload,
  TsfImpactRow,
  TsfModifiedRow,
} from '../../services/sqlDataService';

const DISPLAY_LIMIT = 400;

const formatAmount = (value: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const toDdMmYyyy = (value: string): string => {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return text;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const toDisplayCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
};

const joinDiffSummary = (row: TsfModifiedRow): string =>
  row.differences
    .map((d) => `${d.label}: "${toDisplayCell(d.currentValue)}" -> "${toDisplayCell(d.newValue)}"`)
    .join(' | ');

const formatComparedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
};

const TSFComparison: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TsfComparePayload | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!result) {
      return {
        added: [] as TsfComparableRow[],
        removed: [] as TsfComparableRow[],
        modified: [] as TsfModifiedRow[],
        ledgerImpact: [] as TsfImpactRow[],
        voucherImpact: [] as TsfImpactRow[],
      };
    }
    const q = search.trim().toLowerCase();
    if (!q) {
      return {
        added: result.addedRows,
        removed: result.removedRows,
        modified: result.modifiedRows,
        ledgerImpact: result.ledgerImpact,
        voucherImpact: result.voucherImpact,
      };
    }
    const rowHit = (row: TsfComparableRow) =>
      [
        row.guid,
        row.voucher_number,
        row.voucher_type,
        row.ledger,
        row.party_name,
        row.date,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    return {
      added: result.addedRows.filter(rowHit),
      removed: result.removedRows.filter(rowHit),
      modified: result.modifiedRows.filter((row) => {
        const base = [
          row.guid,
          row.currentRow.voucher_number,
          row.currentRow.voucher_type,
          row.currentRow.ledger,
          row.newRow.ledger,
          row.currentRow.party_name,
          row.newRow.party_name,
          joinDiffSummary(row),
        ]
          .join(' ')
          .toLowerCase();
        return base.includes(q);
      }),
      ledgerImpact: result.ledgerImpact.filter((row) => String(row.ledger || '').toLowerCase().includes(q)),
      voucherImpact: result.voucherImpact.filter((row) => {
        const base = `${row.voucher_number || ''} ${row.date || ''} ${row.voucher_type || ''}`.toLowerCase();
        return base.includes(q);
      }),
    };
  }, [result, search]);

  const handleCompare = async () => {
    if (!file) {
      setError('Please choose a TSF file to compare.');
      return;
    }
    setError('');
    setIsComparing(true);
    try {
      const payload = await compareTallySourceFile(file);
      setResult(payload);
    } catch (err: any) {
      setResult(null);
      setError(err?.message || 'Unable to compare TSF files.');
    } finally {
      setIsComparing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!result) return;
    try {
      const XLSX = await import('xlsx-js-style');
      const workbook = XLSX.utils.book_new();

      const styleHeader = (sheet: any, rows: number, cols: number, numericCols: number[] = [], dateCols: number[] = []) => {
        for (let c = 0; c < cols; c += 1) {
          const cell = XLSX.utils.encode_cell({ r: 0, c });
          if (sheet[cell]) {
            sheet[cell].s = {
              font: { bold: true, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '1F4E78' } },
              alignment: { horizontal: 'center', vertical: 'center' },
            };
          }
        }
        for (let r = 1; r < rows; r += 1) {
          numericCols.forEach((c) => {
            const cell = XLSX.utils.encode_cell({ r, c });
            if (sheet[cell] && typeof sheet[cell].v === 'number') {
              sheet[cell].z = '#,##0.00';
            }
          });
          dateCols.forEach((c) => {
            const cell = XLSX.utils.encode_cell({ r, c });
            if (sheet[cell] && typeof sheet[cell].v === 'string') {
              sheet[cell].v = toDdMmYyyy(sheet[cell].v);
            }
          });
        }
        sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, cols - 1))}${Math.max(1, rows)}` };
        sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
      };

      const addSheet = (
        name: string,
        rows: Array<Record<string, unknown>>,
        headers: Array<{ key: string; label: string; width?: number; numeric?: boolean; date?: boolean }>
      ) => {
        const aoa = [headers.map((h) => h.label)];
        rows.forEach((row) => {
          aoa.push(headers.map((h) => row[h.key] ?? ''));
        });
        const sheet = XLSX.utils.aoa_to_sheet(aoa);
        sheet['!cols'] = headers.map((h) => ({ wch: h.width || 18 }));
        const numericCols = headers
          .map((h, i) => ({ h, i }))
          .filter((x) => !!x.h.numeric)
          .map((x) => x.i);
        const dateCols = headers
          .map((h, i) => ({ h, i }))
          .filter((x) => !!x.h.date)
          .map((x) => x.i);
        styleHeader(sheet, aoa.length, headers.length, numericCols, dateCols);
        XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
      };

      const summaryRows = [
        { metric: 'Compared At', value: formatComparedAt(result.comparedAt) },
        { metric: 'Strict Match Key', value: String(result.strictMatchBy || 'guid').toUpperCase() },
        { metric: 'Current TSF Rows', value: result.summary.currentRows },
        { metric: 'New TSF Rows', value: result.summary.newRows },
        { metric: 'Unchanged Rows', value: result.summary.unchangedRows },
        { metric: 'Added Rows', value: result.summary.addedRows },
        { metric: 'Removed Rows', value: result.summary.removedRows },
        { metric: 'Modified Rows', value: result.summary.modifiedRows },
        { metric: 'Current Amount Total', value: result.summary.currentAmountTotal },
        { metric: 'New Amount Total', value: result.summary.newAmountTotal },
        { metric: 'Added Amount', value: result.summary.addedAmount },
        { metric: 'Removed Amount', value: result.summary.removedAmount },
        { metric: 'Modified Amount Delta', value: result.summary.modifiedAmountDelta },
        { metric: 'Net Amount Delta', value: result.summary.netAmountDelta },
        { metric: 'Impacted Ledgers', value: result.summary.impactedLedgers },
        { metric: 'Impacted Vouchers', value: result.summary.impactedVouchers },
        { metric: 'Duplicate GUIDs (Current)', value: result.summary.duplicateGuidsCurrent },
        { metric: 'Duplicate GUIDs (New)', value: result.summary.duplicateGuidsNew },
        { metric: 'Blank GUID Rows (Current)', value: result.summary.blankGuidRowsCurrent },
        { metric: 'Blank GUID Rows (New)', value: result.summary.blankGuidRowsNew },
      ];

      addSheet('Data Dictionary', [
        { field: 'GUID', meaning: 'Strict matching key used for compare', source: 'Both TSF files' },
        { field: 'Added Rows', meaning: 'GUID exists only in new TSF', source: 'Difference' },
        { field: 'Removed Rows', meaning: 'GUID exists only in current TSF', source: 'Difference' },
        { field: 'Modified Rows', meaning: 'GUID exists in both, but one or more fields changed', source: 'Difference' },
        { field: 'Net Amount Delta', meaning: 'New TSF total amount minus current TSF total amount', source: 'Summary' },
      ], [
        { key: 'field', label: 'Field', width: 26 },
        { key: 'meaning', label: 'Meaning', width: 60 },
        { key: 'source', label: 'Source', width: 20 },
      ]);

      addSheet('Summary', summaryRows, [
        { key: 'metric', label: 'Metric', width: 34 },
        { key: 'value', label: 'Value', width: 28, numeric: true },
      ]);

      const commonRowHeaders = [
        { key: 'guid', label: 'GUID', width: 40 },
        { key: 'date', label: 'Date', width: 14, date: true },
        { key: 'voucher_type', label: 'Voucher Type', width: 20 },
        { key: 'voucher_number', label: 'Voucher Number', width: 22 },
        { key: 'ledger', label: 'Ledger', width: 30 },
        { key: 'party_name', label: 'Party Name', width: 28 },
        { key: 'amount', label: 'Amount', width: 16, numeric: true },
        { key: 'group_name', label: 'Group', width: 24 },
        { key: 'tally_parent', label: 'Tally Parent', width: 24 },
        { key: 'tally_primary', label: 'Tally Primary', width: 24 },
      ];

      addSheet('Added Rows', result.addedRows, commonRowHeaders);
      addSheet('Removed Rows', result.removedRows, commonRowHeaders);

      addSheet(
        'Modified Rows',
        result.modifiedRows.map((row) => ({
          guid: row.guid,
          date_current: row.currentRow.date,
          date_new: row.newRow.date,
          voucher_number_current: row.currentRow.voucher_number,
          voucher_number_new: row.newRow.voucher_number,
          ledger_current: row.currentRow.ledger,
          ledger_new: row.newRow.ledger,
          amount_current: row.currentRow.amount,
          amount_new: row.newRow.amount,
          amount_delta: row.amountDelta,
          changed_fields: row.differences.map((d) => d.label).join(', '),
        })),
        [
          { key: 'guid', label: 'GUID', width: 40 },
          { key: 'date_current', label: 'Current Date', width: 14, date: true },
          { key: 'date_new', label: 'New Date', width: 14, date: true },
          { key: 'voucher_number_current', label: 'Current Voucher No', width: 22 },
          { key: 'voucher_number_new', label: 'New Voucher No', width: 22 },
          { key: 'ledger_current', label: 'Current Ledger', width: 28 },
          { key: 'ledger_new', label: 'New Ledger', width: 28 },
          { key: 'amount_current', label: 'Current Amount', width: 16, numeric: true },
          { key: 'amount_new', label: 'New Amount', width: 16, numeric: true },
          { key: 'amount_delta', label: 'Amount Delta', width: 16, numeric: true },
          { key: 'changed_fields', label: 'Changed Fields', width: 55 },
        ]
      );

      addSheet(
        'Field Diffs',
        result.modifiedRows.flatMap((row) =>
          row.differences.map((diff) => ({
            guid: row.guid,
            voucher_number: row.newRow.voucher_number || row.currentRow.voucher_number,
            date: row.newRow.date || row.currentRow.date,
            field: diff.label,
            current_value: toDisplayCell(diff.currentValue),
            new_value: toDisplayCell(diff.newValue),
          }))
        ),
        [
          { key: 'guid', label: 'GUID', width: 40 },
          { key: 'voucher_number', label: 'Voucher Number', width: 24 },
          { key: 'date', label: 'Date', width: 14, date: true },
          { key: 'field', label: 'Field', width: 24 },
          { key: 'current_value', label: 'Current Value', width: 34 },
          { key: 'new_value', label: 'New Value', width: 34 },
        ]
      );

      addSheet('Ledger Impact', result.ledgerImpact, [
        { key: 'ledger', label: 'Ledger', width: 34 },
        { key: 'currentAmount', label: 'Current Amount', width: 18, numeric: true },
        { key: 'newAmount', label: 'New Amount', width: 18, numeric: true },
        { key: 'delta', label: 'Delta', width: 18, numeric: true },
      ]);

      addSheet('Voucher Impact', result.voucherImpact, [
        { key: 'voucher_number', label: 'Voucher Number', width: 24 },
        { key: 'date', label: 'Date', width: 14, date: true },
        { key: 'voucher_type', label: 'Voucher Type', width: 22 },
        { key: 'currentAmount', label: 'Current Amount', width: 18, numeric: true },
        { key: 'newAmount', label: 'New Amount', width: 18, numeric: true },
        { key: 'delta', label: 'Delta', width: 18, numeric: true },
      ]);

      addSheet('Duplicate GUIDs', [
        ...result.duplicateGuids.current.map((r) => ({ dataset: 'Current TSF', guid: r.guid, count: r.count })),
        ...result.duplicateGuids.new.map((r) => ({ dataset: 'New TSF', guid: r.guid, count: r.count })),
      ], [
        { key: 'dataset', label: 'Dataset', width: 14 },
        { key: 'guid', label: 'GUID', width: 40 },
        { key: 'count', label: 'Occurrences', width: 14, numeric: true },
      ]);

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `TSF_Comparison_${stamp}.xlsx`, { compression: true, cellStyles: true });
    } catch (err) {
      console.error(err);
      window.alert('Unable to export TSF comparison Excel. Please retry.');
    }
  };

  const renderRowTable = (title: string, rows: TsfComparableRow[], tone: 'green' | 'red') => {
    const tonedClass =
      tone === 'green'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-rose-200 bg-rose-50 text-rose-900';

    return (
      <section className={`rounded-xl border ${tonedClass} p-4`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h4 className="font-semibold">{title} ({rows.length.toLocaleString()})</h4>
          {rows.length > DISPLAY_LIMIT && (
            <span className="text-xs opacity-80">Showing first {DISPLAY_LIMIT.toLocaleString()} rows. Export Excel for full list.</span>
          )}
        </div>
        <div className="overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left">GUID</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Voucher</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Ledger</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, DISPLAY_LIMIT).map((row) => (
                <tr key={`${title}-${row.guid}`} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-mono text-[11px]">{row.guid}</td>
                  <td className="px-3 py-2">{toDdMmYyyy(row.date)}</td>
                  <td className="px-3 py-2">{row.voucher_number || '-'}</td>
                  <td className="px-3 py-2">{row.voucher_type || '-'}</td>
                  <td className="px-3 py-2">{row.ledger || '-'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatAmount(row.amount)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-500">No rows</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-lg font-bold text-slate-800">TSF Comparison (Strict GUID Match)</h3>
        <p className="text-sm text-slate-600 mt-1">
          Current loaded TSF is treated as base. Upload another TSF to detect added, removed, and modified GUID rows with numerical impact.
        </p>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
          <input
            type="file"
            accept=".tsf,.sqlite,.db"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
          />
          <button
            onClick={handleCompare}
            disabled={isComparing || !file}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${
              isComparing || !file
                ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isComparing ? <RefreshCcw size={15} className="animate-spin" /> : <FileUp size={15} />}
            {isComparing ? 'Comparing...' : 'Compare TSF'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={!result}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${
              result
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-slate-300 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Download size={15} />
            Export Excel
          </button>
        </div>

        {file && (
          <p className="mt-2 text-xs text-slate-600">
            New TSF selected: <span className="font-semibold">{file.name}</span>
          </p>
        )}
        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>
        )}
      </section>

      {result && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Rows</div>
              <div className="mt-2 text-sm text-slate-700">Current: <strong>{result.summary.currentRows.toLocaleString()}</strong></div>
              <div className="text-sm text-slate-700">New: <strong>{result.summary.newRows.toLocaleString()}</strong></div>
              <div className="text-sm text-slate-700">Unchanged: <strong>{result.summary.unchangedRows.toLocaleString()}</strong></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Differences</div>
              <div className="mt-2 text-sm text-emerald-700">Added: <strong>{result.summary.addedRows.toLocaleString()}</strong></div>
              <div className="text-sm text-rose-700">Removed: <strong>{result.summary.removedRows.toLocaleString()}</strong></div>
              <div className="text-sm text-amber-700">Modified: <strong>{result.summary.modifiedRows.toLocaleString()}</strong></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Numerical Impact</div>
              <div className="mt-2 text-sm text-slate-700">Added Amt: <strong>{formatAmount(result.summary.addedAmount)}</strong></div>
              <div className="text-sm text-slate-700">Removed Amt: <strong>{formatAmount(result.summary.removedAmount)}</strong></div>
              <div className="text-sm text-slate-700">Modified Delta: <strong>{formatAmount(result.summary.modifiedAmountDelta)}</strong></div>
              <div className={`text-sm font-semibold ${result.summary.netAmountDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                Net Delta: {formatAmount(result.summary.netAmountDelta)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Compare Meta</div>
              <div className="mt-2 text-sm text-slate-700">Key: <strong>{String(result.strictMatchBy || 'guid').toUpperCase()}</strong></div>
              <div className="text-sm text-slate-700">Compared: <strong>{formatComparedAt(result.comparedAt)}</strong></div>
              <div className="text-sm text-slate-700">Impacted Ledgers: <strong>{result.summary.impactedLedgers.toLocaleString()}</strong></div>
              <div className="text-sm text-slate-700">Impacted Vouchers: <strong>{result.summary.impactedVouchers.toLocaleString()}</strong></div>
            </div>
          </section>

          {(result.summary.duplicateGuidsCurrent > 0 ||
            result.summary.duplicateGuidsNew > 0 ||
            result.summary.blankGuidRowsCurrent > 0 ||
            result.summary.blankGuidRowsNew > 0) && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> GUID quality alerts</div>
              <div className="text-sm mt-1">
                Duplicate GUIDs (Current/New): {result.summary.duplicateGuidsCurrent} / {result.summary.duplicateGuidsNew}
              </div>
              <div className="text-sm">
                Blank GUID rows (Current/New): {result.summary.blankGuidRowsCurrent} / {result.summary.blankGuidRowsNew}
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-center">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search GUID, voucher number, ledger, party..."
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
              <div className="text-xs text-slate-500">Filtered results are applied across all tables below.</div>
            </div>
          </section>

          {renderRowTable('Added GUID Rows', filtered.added, 'green')}
          {renderRowTable('Removed GUID Rows', filtered.removed, 'red')}

          <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h4 className="font-semibold text-amber-900">Modified GUID Rows ({filtered.modified.length.toLocaleString()})</h4>
              {filtered.modified.length > DISPLAY_LIMIT && (
                <span className="text-xs text-amber-800">Showing first {DISPLAY_LIMIT.toLocaleString()} rows. Export Excel for full list.</span>
              )}
            </div>
            <div className="overflow-auto bg-white rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left">GUID</th>
                    <th className="px-3 py-2 text-left">Voucher</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Changed Fields</th>
                    <th className="px-3 py-2 text-right">Amount Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.modified.slice(0, DISPLAY_LIMIT).map((row) => (
                    <tr key={`mod-${row.guid}`} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-2 font-mono text-[11px]">{row.guid}</td>
                      <td className="px-3 py-2">{row.newRow.voucher_number || row.currentRow.voucher_number || '-'}</td>
                      <td className="px-3 py-2">{toDdMmYyyy(row.newRow.date || row.currentRow.date)}</td>
                      <td className="px-3 py-2 max-w-[620px] whitespace-pre-wrap break-words">{joinDiffSummary(row) || '-'}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.amountDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {formatAmount(row.amountDelta)}
                      </td>
                    </tr>
                  ))}
                  {filtered.modified.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-slate-500">No rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="font-semibold text-slate-800 mb-3">Ledger Impact ({filtered.ledgerImpact.length.toLocaleString()})</h4>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Ledger</th>
                      <th className="px-3 py-2 text-right">Current</th>
                      <th className="px-3 py-2 text-right">New</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.ledgerImpact.slice(0, DISPLAY_LIMIT).map((row, idx) => (
                      <tr key={`ledger-${row.ledger || idx}`} className="border-t border-slate-200">
                        <td className="px-3 py-2">{row.ledger || '(Blank Ledger)'}</td>
                        <td className="px-3 py-2 text-right">{formatAmount(row.currentAmount)}</td>
                        <td className="px-3 py-2 text-right">{formatAmount(row.newAmount)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${row.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatAmount(row.delta)}
                        </td>
                      </tr>
                    ))}
                    {filtered.ledgerImpact.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">No impacted ledgers</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="font-semibold text-slate-800 mb-3">Voucher Impact ({filtered.voucherImpact.length.toLocaleString()})</h4>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Voucher</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.voucherImpact.slice(0, DISPLAY_LIMIT).map((row, idx) => (
                      <tr key={`voucher-${row.voucherKey || idx}`} className="border-t border-slate-200">
                        <td className="px-3 py-2">{row.voucher_number || '-'}</td>
                        <td className="px-3 py-2">{toDdMmYyyy(String(row.date || ''))}</td>
                        <td className="px-3 py-2">{row.voucher_type || '-'}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${row.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatAmount(row.delta)}
                        </td>
                      </tr>
                    ))}
                    {filtered.voucherImpact.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">No impacted vouchers</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default TSFComparison;
