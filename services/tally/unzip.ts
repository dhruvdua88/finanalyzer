// Reads a Tally export ZIP (produced by the external Tally exporter) and
// returns each .xlsx inside as an array of raw rows. Header keys are
// lower-cased here — every consumer downstream relies on that.
//
// JSZip is imported lazily so the dependency only enters the bundle when
// the user actually picks a ZIP file.

import { lowercaseKeys } from './helpers';

type Row = Record<string, any>;

let jszipModulePromise: Promise<any> | null = null;
const getJsZip = async () => {
  if (!jszipModulePromise) {
    jszipModulePromise = import('jszip').then((m) => m.default || m);
  }
  return jszipModulePromise;
};

let xlsxModulePromise: Promise<any> | null = null;
const getXlsx = async () => {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx');
  }
  return xlsxModulePromise;
};

// Map of `tableName` → raw row array. `tableName` is the file basename without
// extension, lower-cased (e.g. "trn_voucher", "mst_ledger").
export type RawTables = Map<string, Row[]>;

export interface UnzipResult {
  tables: RawTables;
  readmeText: string;            // README_FOR_LLM.md if present (diagnostic)
  fileList: string[];            // every file found in the zip (diagnostic)
}

const baseName = (path: string): string => {
  const ix = path.lastIndexOf('/');
  return ix >= 0 ? path.slice(ix + 1) : path;
};

const tableNameFromFile = (fileName: string): string => {
  const base = baseName(fileName).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
};

export const unzipTallyExport = async (file: File | Blob): Promise<UnzipResult> => {
  const JSZip = await getJsZip();
  const XLSX = await getXlsx();

  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const tables: RawTables = new Map();
  const fileList: string[] = [];
  let readmeText = '';

  const entries: Array<{ name: string; entry: any }> = [];
  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return;
    entries.push({ name: relativePath, entry: zipEntry });
  });

  // Process files in parallel — JSZip's async() returns a Promise so we
  // hand a queue to Promise.all rather than awaiting sequentially.
  await Promise.all(entries.map(async ({ name, entry }) => {
    fileList.push(name);
    const lower = name.toLowerCase();

    if (lower.endsWith('readme_for_llm.md') || lower.endsWith('readme.md')) {
      try { readmeText = await entry.async('string'); } catch { /* skip */ }
      return;
    }

    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) return;

    const buf = await entry.async('arraybuffer');
    const wb = XLSX.read(buf, { type: 'array', dense: true });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return;
    const sheet = wb.Sheets[firstSheetName];
    // defval: '' so missing cells become '' instead of being dropped — the
    // typed parsers downstream all assume every column is at least defined.
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    tables.set(tableNameFromFile(name), rows.map(lowercaseKeys));
  }));

  return { tables, readmeText, fileList };
};

// Convenience for test/debug use: read a single .xlsx (e.g. unzipped on disk)
// into raw rows. Not used by the production import path.
export const readXlsxFile = async (file: File | Blob): Promise<Row[]> => {
  const XLSX = await getXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', dense: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const rows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets[firstSheetName], { defval: '' });
  return rows.map(lowercaseKeys);
};
