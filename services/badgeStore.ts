import { AnalysisType } from '../types';

const BADGE_KEY  = 'finanalyzer_badges';
const RECENT_KEY = 'finanalyzer_recent';
const LASTRUN_KEY = 'finanalyzer_last_run';
const EVENT_NAME  = 'finanalyzer_badge_update';

// ── Badge counts ──────────────────────────────────────────────────────────────

export function setBadge(module: AnalysisType, count: number): void {
  try {
    const badges = JSON.parse(localStorage.getItem(BADGE_KEY) || '{}');
    if (count === 0) delete badges[module];
    else badges[module] = count;
    localStorage.setItem(BADGE_KEY, JSON.stringify(badges));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {}
}

export function getAllBadges(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BADGE_KEY) || '{}'); } catch { return {}; }
}

// ── Recently visited ──────────────────────────────────────────────────────────

export function recordVisit(module: AnalysisType): void {
  try {
    const recent: AnalysisType[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const updated = [module, ...recent.filter((m) => m !== module)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {}
}

export function getRecentModules(): AnalysisType[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

// ── Last run timestamps ───────────────────────────────────────────────────────

export function recordRun(module: AnalysisType): void {
  try {
    const runs: Record<string, string> = JSON.parse(localStorage.getItem(LASTRUN_KEY) || '{}');
    runs[module] = new Date().toISOString();
    localStorage.setItem(LASTRUN_KEY, JSON.stringify(runs));
  } catch {}
}

export function getLastRun(module: AnalysisType): string | null {
  try {
    const runs: Record<string, string> = JSON.parse(localStorage.getItem(LASTRUN_KEY) || '{}');
    return runs[module] ?? null;
  } catch { return null; }
}

export function formatLastRun(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
