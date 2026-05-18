// Shared coercion helpers for parsing Tally XLSX rows. The exporter writes
// every cell as text-ish (numbers come as quoted strings, booleans as "1"/"0"),
// so every typed field flows through one of these.

export const toText = (value: any): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const toNumber = (value: any): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const asText = toText(value).replace(/,/g, '');
  if (!asText) return 0;
  const parsed = Number(asText);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const toBool = (value: any): boolean => {
  const t = toText(value).toLowerCase();
  if (t === '1' || t === 'true' || t === 'yes' || t === 'y') return true;
  if (t === '0' || t === 'false' || t === 'no' || t === 'n' || t === '') return false;
  const n = Number(t);
  return Number.isFinite(n) ? n > 0 : false;
};

export const toBoolNum = (value: any): 0 | 1 => (toBool(value) ? 1 : 0);

// Tally XLSX dates arrive in three flavours: ISO ("2025-12-25"), DD/MM/YYYY,
// or Excel serial numbers. We canonicalise to ISO so every downstream module
// can compare with `string < string`.
export const toIsoDate = (value: any): string => {
  if (value === null || value === undefined || value === '') return '';
  // Excel serial-number date (rare in xlsx-js output but possible)
  if (typeof value === 'number' && Number.isFinite(value) && value > 30000) {
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = toText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ddmmyyyy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const ddmmyy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{2})$/);
  if (ddmmyy) {
    const yy = Number(ddmmyy[3]);
    const yyyy = yy < 70 ? `20${ddmmyy[3]}` : `19${ddmmyy[3]}`;
    return `${yyyy}-${ddmmyy[2]}-${ddmmyy[1]}`;
  }
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
};

// Tally ledger / group / item names are case-significant but space-noisy
// (trailing newlines, double spaces). Joins must use this normalised key.
export const nameKey = (value: any): string =>
  toText(value).replace(/\s+/g, ' ').toLowerCase();

// Lowercases header keys so a row produced by xlsx-js (which preserves
// original column case) can be indexed predictably.
export const lowercaseKeys = (row: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const k of Object.keys(row || {})) out[k.trim().toLowerCase()] = row[k];
  return out;
};
