import React, { Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import { LedgerEntry, AnalysisType, AuditSettings } from './types';
import { clearSqlData, exportTallySourceFile, fetchRowsFromSql, isSqlBackendAvailable, loadRowsIntoSql, SqlLoadSummary } from './services/sqlDataService';
import { LayoutDashboard, Receipt, FileSpreadsheet, ArrowLeft, BarChart3, FileInput, Ban, TrendingUp, BookOpen, ShieldCheck, Settings2, PieChart, FileText, Landmark, Clock3, Download, Users2, Menu, X, Wallet, FileSearch, AlertTriangle, ShieldAlert, GitCompare, Moon, Sun, Search, History, CheckCircle2, AlertCircle, ChevronRight, Zap } from 'lucide-react';
import { ModuleSkeleton } from './components/ui/Skeleton';
import { getAllBadges, getRecentModules, recordVisit, recordRun, getLastRun, formatLastRun } from './services/badgeStore';

const GSTRateAnalysis = lazy(() => import('./components/modules/GSTRateAnalysis'));
const SalesRegister = lazy(() => import('./components/modules/SalesRegister'));
const TDSAnalysis = lazy(() => import('./components/modules/TDSAnalysis'));
const RCMAnalysis = lazy(() => import('./components/modules/RCMAnalysis'));
const GSTExpenseAnalysis = lazy(() => import('./components/modules/GSTExpenseAnalysis'));
const VarianceAnalysis = lazy(() => import('./components/modules/VarianceAnalysis'));
const LedgerAnalytics = lazy(() => import('./components/modules/LedgerAnalytics'));
const PartyLedgerMatrix = lazy(() => import('./components/modules/PartyLedgerMatrix'));
const RelatedPartyAnalysis = lazy(() => import('./components/modules/RelatedPartyAnalysis'));
const AuditSetup = lazy(() => import('./components/modules/AuditSetup'));
const GSTLedgerSummary = lazy(() => import('./components/modules/GSTLedgerSummary'));
const TrialBalanceAnalysis = lazy(() => import('./components/modules/TrialBalanceAnalysis'));
const DebtorAgeingFIFO = lazy(() => import('./components/modules/DebtorAgeingFIFO'));
const CreditorAgeingFIFO = lazy(() => import('./components/modules/CreditorAgeingFIFO'));
const PurchaseGSTRegister = lazy(() => import('./components/modules/PurchaseGSTRegister'));
const GSTR2BReconciliation = lazy(() => import('./components/modules/GSTR2BReconciliation'));
const VoucherBookView = lazy(() => import('./components/modules/VoucherBookView'));
const LedgerVoucherView = lazy(() => import('./components/modules/LedgerVoucherView'));
const CashFlowAnalysis = lazy(() => import('./components/modules/CashFlowAnalysis'));
const ProfitLossAnalysis = lazy(() => import('./components/modules/ProfitLossAnalysis'));
const ExceptionDensityHeatmapAnalytics = lazy(() => import('./components/modules/ExceptionDensityHeatmapAnalytics'));
const BalanceSheetCleanlinessAnalytics = lazy(() => import('./components/modules/BalanceSheetCleanlinessAnalytics'));
const TSFComparison = lazy(() => import('./components/modules/TSFComparison'));
const ITC3BReconciliation = lazy(() => import('./components/modules/ITC3BReconciliation'));
const OrphanPLVouchers = lazy(() => import('./components/modules/OrphanPLVouchers'));

const MODULE_LABELS: Record<AnalysisType, string> = {
  [AnalysisType.DASHBOARD]: 'Dashboard Overview',
  [AnalysisType.AUDIT_CONFIG]: 'Audit Configuration Manager',
  [AnalysisType.TRIAL_BALANCE]: 'Trial Balance Analysis',
  [AnalysisType.DEBTOR_AGEING]: 'Debtor Ageing (FIFO)',
  [AnalysisType.CREDITOR_AGEING]: 'Creditor Ageing (FIFO)',
  [AnalysisType.VOUCHER_BOOK_VIEW]: 'Voucher Book View',
  [AnalysisType.LEDGER_VOUCHER_VIEW]: 'Ledger Statement',
  [AnalysisType.GST_RATE]: 'Sales GST Rate Analysis',
  [AnalysisType.SALES_REGISTER]: 'Sales Register',
  [AnalysisType.PURCHASE_GST_REGISTER]: 'Purchase GST Register',
  [AnalysisType.GSTR2B_RECONCILIATION]: 'GSTR-2B Reconciliation',
  [AnalysisType.TDS_ANALYSIS]: 'TDS Analysis',
  [AnalysisType.RCM_ANALYSIS]: 'Reverse Charge (RCM) Analysis',
  [AnalysisType.GST_EXPENSE_ANALYSIS]: 'Blocked Credit Analysis',
  [AnalysisType.PROFIT_LOSS_ANALYSIS]: 'Profit & Loss Analysis',
  [AnalysisType.CASH_FLOW_ANALYSIS]: 'Cash Flow Analysis',
  [AnalysisType.VARIANCE_ANALYSIS]: 'Month-on-Month Variance Analysis',
  [AnalysisType.EXCEPTION_DENSITY_HEATMAP]: 'Exception Density Heatmap Analytics',
  [AnalysisType.BALANCE_SHEET_CLEANLINESS]: 'Balance Sheet Cleanliness Analytics',
  [AnalysisType.TSF_COMPARISON]: 'TSF Comparison',
  [AnalysisType.LEDGER_ANALYTICS]: 'Accounting Ledger Analytics',
  [AnalysisType.PARTY_LEDGER_MATRIX]: 'Party Ledger Transaction Matrix',
  [AnalysisType.RELATED_PARTY_ANALYSIS]: 'Related Party (RPT) Analysis',
  [AnalysisType.GST_LEDGER_SUMMARY]: 'GST Ledger Constitution Analysis',
  [AnalysisType.ITC_3B_RECONCILIATION]: 'ITC vs 3B Reconciliation',
  [AnalysisType.ORPHAN_PL_VOUCHERS]: 'Orphan P&L Vouchers',
};

type ModuleIcon = React.ComponentType<{ size?: number; className?: string }>;

const MODULE_ICONS: Record<AnalysisType, ModuleIcon> = {
  [AnalysisType.DASHBOARD]: LayoutDashboard,
  [AnalysisType.AUDIT_CONFIG]: Settings2,
  [AnalysisType.TRIAL_BALANCE]: Landmark,
  [AnalysisType.DEBTOR_AGEING]: Clock3,
  [AnalysisType.CREDITOR_AGEING]: Clock3,
  [AnalysisType.VOUCHER_BOOK_VIEW]: Receipt,
  [AnalysisType.LEDGER_VOUCHER_VIEW]: BookOpen,
  [AnalysisType.GST_RATE]: Receipt,
  [AnalysisType.SALES_REGISTER]: FileText,
  [AnalysisType.PURCHASE_GST_REGISTER]: FileText,
  [AnalysisType.GSTR2B_RECONCILIATION]: FileSearch,
  [AnalysisType.TDS_ANALYSIS]: FileSpreadsheet,
  [AnalysisType.RCM_ANALYSIS]: FileInput,
  [AnalysisType.GST_EXPENSE_ANALYSIS]: Ban,
  [AnalysisType.PROFIT_LOSS_ANALYSIS]: FileText,
  [AnalysisType.CASH_FLOW_ANALYSIS]: Wallet,
  [AnalysisType.VARIANCE_ANALYSIS]: TrendingUp,
  [AnalysisType.EXCEPTION_DENSITY_HEATMAP]: ShieldAlert,
  [AnalysisType.BALANCE_SHEET_CLEANLINESS]: AlertTriangle,
  [AnalysisType.TSF_COMPARISON]: GitCompare,
  [AnalysisType.LEDGER_ANALYTICS]: BookOpen,
  [AnalysisType.PARTY_LEDGER_MATRIX]: Users2,
  [AnalysisType.RELATED_PARTY_ANALYSIS]: ShieldCheck,
  [AnalysisType.GST_LEDGER_SUMMARY]: PieChart,
  [AnalysisType.ITC_3B_RECONCILIATION]: FileSearch,
  [AnalysisType.ORPHAN_PL_VOUCHERS]: AlertTriangle,
};

const MODULE_SECTIONS: Array<{ id: string; title: string; description: string; modules: AnalysisType[] }> = [
  {
    id: 'setup',
    title: 'Setup',
    description: 'Start here before running detailed checks.',
    modules: [AnalysisType.DASHBOARD, AnalysisType.AUDIT_CONFIG],
  },
  {
    id: 'tsf-compare',
    title: 'TSF Compare',
    description: 'Compare current loaded TSF with a new TSF by strict GUID.',
    modules: [AnalysisType.TSF_COMPARISON],
  },
  {
    id: 'core-audit',
    title: 'Core Audit',
    description: 'Ledger, party, and balance sheet intelligence.',
    modules: [
      AnalysisType.LEDGER_ANALYTICS,
      AnalysisType.VOUCHER_BOOK_VIEW,
      AnalysisType.LEDGER_VOUCHER_VIEW,
      AnalysisType.PARTY_LEDGER_MATRIX,
      AnalysisType.RELATED_PARTY_ANALYSIS,
      AnalysisType.TRIAL_BALANCE,
    ],
  },
  {
    id: 'ageing',
    title: 'Ageing',
    description: 'Receivables and payables ageing views.',
    modules: [AnalysisType.DEBTOR_AGEING, AnalysisType.CREDITOR_AGEING],
  },
  {
    id: 'gst-tax',
    title: 'GST & Tax',
    description: 'GST rates, registers, and tax compliance checks.',
    modules: [
      AnalysisType.GST_RATE,
      AnalysisType.SALES_REGISTER,
      AnalysisType.PURCHASE_GST_REGISTER,
      AnalysisType.GSTR2B_RECONCILIATION,
      AnalysisType.ITC_3B_RECONCILIATION,
      AnalysisType.GST_LEDGER_SUMMARY,
      AnalysisType.TDS_ANALYSIS,
      AnalysisType.RCM_ANALYSIS,
      AnalysisType.GST_EXPENSE_ANALYSIS,
    ],
  },
  {
    id: 'trends',
    title: 'Trends',
    description: 'Period-over-period movement analysis.',
    modules: [AnalysisType.PROFIT_LOSS_ANALYSIS, AnalysisType.CASH_FLOW_ANALYSIS, AnalysisType.VARIANCE_ANALYSIS],
  },
  {
    id: 'advanced-analytics',
    title: 'Advanced Analytics',
    description: 'Exception density and balance sheet hygiene diagnostics.',
    modules: [
      AnalysisType.EXCEPTION_DENSITY_HEATMAP,
      AnalysisType.BALANCE_SHEET_CLEANLINESS,
      AnalysisType.ORPHAN_PL_VOUCHERS,
    ],
  },
];

const QUERY_DRIVEN_SQL_MODULES = new Set<AnalysisType>([
  AnalysisType.SALES_REGISTER,
  AnalysisType.PURCHASE_GST_REGISTER,
  AnalysisType.ITC_3B_RECONCILIATION,
  AnalysisType.PROFIT_LOSS_ANALYSIS,
  AnalysisType.VOUCHER_BOOK_VIEW,
  AnalysisType.LEDGER_VOUCHER_VIEW,
]);

const App: React.FC = () => {
  const [data, setData] = useState<LedgerEntry[]>([]);
  const [activeModule, setActiveModule] = useState<AnalysisType>(AnalysisType.DASHBOARD);
  const [hasDataset, setHasDataset] = useState(false);
  const [isSqlMode, setIsSqlMode] = useState(false);
  const [sqlNote, setSqlNote] = useState('');
  const [isModuleDataLoading, setIsModuleDataLoading] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<SqlLoadSummary>({
    totalRows: 0,
    uniqueVouchers: 0,
    minDate: '',
    maxDate: '',
  });
  
  // Centralized Audit Settings
  const [settings, setSettings] = useState<AuditSettings>(() => {
    const defaults: AuditSettings = {
      salesGstLedgers: [],
      purchaseGstLedgers: [],
      tdsTaxLedgers: [],
      rcmTaxLedgers: [],
      blockedCreditLedgers: [],
      relatedParties: [],
      gstLedgerSummary: [],
      partyMatrixProfile: {
        selectedPrimaryGroup: '',
        tdsLedgers: [],
        gstLedgers: [],
        rcmLedgers: [],
      },
      relatedPartyProfile: {
        parties: {},
        ledgerTxType: {},
        thresholds: {
          materialityRupees: 1_000_000,
          yearEndDays: 30,
          roundAmountUnit: 100_000,
          section188TurnoverPct: 10,
          annualTurnover: 0,
        },
        approvals: {},
      },
      tdsThresholdConfig: { enabled: false, sectionMappings: [] },
      tdsAnnotations: [],
    };

    try {
      const saved = localStorage.getItem('finanalyzer_audit_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...defaults,
          ...parsed,
          partyMatrixProfile: {
            ...defaults.partyMatrixProfile,
            ...(parsed?.partyMatrixProfile || {}),
          },
          relatedPartyProfile: {
            ...defaults.relatedPartyProfile!,
            ...(parsed?.relatedPartyProfile || {}),
            thresholds: {
              ...defaults.relatedPartyProfile!.thresholds,
              ...((parsed?.relatedPartyProfile?.thresholds) || {}),
            },
          },
          tdsThresholdConfig: {
            ...defaults.tdsThresholdConfig,
            ...(parsed?.tdsThresholdConfig || {}),
          },
          tdsAnnotations: Array.isArray(parsed?.tdsAnnotations) ? parsed.tdsAnnotations : [],
        };
      }
    } catch (e) {}
    return defaults;
  });

  // ── Dark mode ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('finanalyzer_dark_mode') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('finanalyzer_dark_mode', String(darkMode)); } catch {}
  }, [darkMode]);

  // ── Recently visited modules ───────────────────────────────────────────────
  const [recentModules, setRecentModules] = useState<AnalysisType[]>(() => getRecentModules());

  // ── Anomaly badges (written by modules, read here) ─────────────────────────
  const [anomalyBadges, setAnomalyBadges] = useState<Record<string, number>>(() => getAllBadges());

  useEffect(() => {
    const refresh = () => setAnomalyBadges(getAllBadges());
    window.addEventListener('finanalyzer_badge_update', refresh);
    return () => window.removeEventListener('finanalyzer_badge_update', refresh);
  }, []);

  // ── Last-run tracking ──────────────────────────────────────────────────────
  const [lastRunMap, setLastRunMap] = useState<Record<string, string | null>>({});

  // ── Sidebar search ─────────────────────────────────────────────────────────
  const [sidebarSearch, setSidebarSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K → focus sidebar search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsMobileNavOpen(false);
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // Escape → clear search
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSidebarSearch('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Module switcher (records visit + last-run) ─────────────────────────────
  const switchModule = useCallback((module: AnalysisType) => {
    setActiveModule(module);
    setSidebarSearch('');
    recordVisit(module);
    setRecentModules(getRecentModules());
    recordRun(module);
    setLastRunMap((prev) => ({ ...prev, [module]: new Date().toISOString() }));
  }, []);

  // ── Update checker ─────────────────────────────────────────────────────────
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const meta = await fetch('/metadata.json').then((r) => r.json());
        if (!meta?.updateCheckUrl) return;
        const latest = await fetch(meta.updateCheckUrl).then((r) => r.json());
        if (latest?.version && meta?.version && latest.version !== meta.version) {
          setUpdateAvailable(latest.version);
        }
      } catch { /* silently skip if unreachable */ }
    };
    check();
  }, []);

  useEffect(() => {
    localStorage.setItem('finanalyzer_audit_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [activeModule]);

  useEffect(() => {
    if (!isMobileNavOpen) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileNavOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onEscape);
    };
  }, [isMobileNavOpen]);

  const isAccountingVoucherEntry = (entry: LedgerEntry): boolean => {
    const raw = entry?.is_accounting_voucher;
    if (raw === undefined || raw === null || String(raw).trim() === '') return true;
    const text = String(raw).trim().toLowerCase();
    if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
    if (text === '0' || text === 'false' || text === 'no' || text === 'n') return false;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed > 0 : false;
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

  const summarizeRows = (rows: LedgerEntry[]): SqlLoadSummary => {
    const transactionalRows = rows.filter((row) => isAccountingVoucherEntry(row) && !isMasterLedgerEntry(row));
    let minDate = '';
    let maxDate = '';
    const voucherSet = new Set<string>();

    transactionalRows.forEach((row) => {
      if (row.voucher_number) voucherSet.add(row.voucher_number);
      if (row.date) {
        if (!minDate || row.date < minDate) minDate = row.date;
        if (!maxDate || row.date > maxDate) maxDate = row.date;
      }
    });

    return {
      totalRows: transactionalRows.length,
      uniqueVouchers: voucherSet.size,
      minDate,
      maxDate,
    };
  };

  const handleDataLoaded = async (parsedData: LedgerEntry[]) => {
    const accountingRows = parsedData.filter(isAccountingVoucherEntry);
    setActiveModule(AnalysisType.DASHBOARD);
    setSqlNote('');
    setIsModuleDataLoading(true);

    const sqlAvailable = await isSqlBackendAvailable();

    if (sqlAvailable) {
      try {
        const summary = await loadRowsIntoSql(accountingRows);
        setIsSqlMode(true);
        setHasDataset(true);
        setData([]);
        setDashboardSummary(summary);
        setIsModuleDataLoading(false);
        return;
      } catch (error: any) {
        const message = error?.message || 'SQL load failed. Falling back to in-memory mode.';
        setSqlNote(message);
      }
    } else {
      setSqlNote('SQL backend unavailable. Running in in-memory fallback mode.');
    }

    setIsSqlMode(false);
    setHasDataset(true);
    setData(accountingRows);
    setDashboardSummary(summarizeRows(accountingRows));
    setIsModuleDataLoading(false);
  };

  const updateSettings = (newSettings: Partial<AuditSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      partyMatrixProfile: {
        ...prev.partyMatrixProfile,
        ...(newSettings.partyMatrixProfile || {}),
      },
      // RelatedPartyProfile is replaced wholesale (not deep-merged) when
      // the module emits an update — its inner shape (parties dict, ledger
      // overrides, approvals dict) makes deep merge ambiguous.
      relatedPartyProfile:
        newSettings.relatedPartyProfile !== undefined
          ? newSettings.relatedPartyProfile
          : prev.relatedPartyProfile,
    }));
  };

  const transactionData = useMemo(
    () => data.filter((entry) => isAccountingVoucherEntry(entry) && !isMasterLedgerEntry(entry)),
    [data]
  );

  useEffect(() => {
    if (!hasDataset || !isSqlMode) return;

    let cancelled = false;

    const loadFromSql = async () => {
      setIsModuleDataLoading(true);
      try {
        if (activeModule === AnalysisType.DASHBOARD) {
          if (cancelled) return;
          setData([]);
        } else if (QUERY_DRIVEN_SQL_MODULES.has(activeModule)) {
          if (cancelled) return;
          // These modules use optimized module-specific SQL APIs and avoid loading full rowset.
          setData([]);
        } else {
          const rows = await fetchRowsFromSql();
          if (cancelled) return;
          setData(rows.filter(isAccountingVoucherEntry));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message || 'SQL query failed. Falling back to in-memory mode.';
        setSqlNote(message);
        setIsSqlMode(false);
      } finally {
        if (!cancelled) setIsModuleDataLoading(false);
      }
    };

    loadFromSql();
    return () => {
      cancelled = true;
    };
  }, [activeModule, hasDataset, isSqlMode]);

  const resetDataset = () => {
    setActiveModule(AnalysisType.DASHBOARD);
    setData([]);
    setHasDataset(false);
    setIsSqlMode(false);
    setSqlNote('');
    setIsModuleDataLoading(false);
    setDashboardSummary({
      totalRows: 0,
      uniqueVouchers: 0,
      minDate: '',
      maxDate: '',
    });
    clearSqlData();
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExportSourceFile = async () => {
    try {
      setSqlNote('');
      if (!isSqlMode) {
        const sqlAvailable = await isSqlBackendAvailable();
        if (!sqlAvailable) {
          throw new Error('Source file export requires SQL backend in dev mode.');
        }
        const accountingRows = data.filter(isAccountingVoucherEntry);
        const summary = await loadRowsIntoSql(accountingRows);
        setIsSqlMode(true);
        setDashboardSummary(summary);
      }

      const blob = await exportTallySourceFile();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `Tally_Source_File_${stamp}.tsf`);
    } catch (error: any) {
      setSqlNote(error?.message || 'Unable to export Tally source file.');
    }
  };

  const activeSection = useMemo(
    () => MODULE_SECTIONS.find((section) => section.modules.includes(activeModule))?.title ?? 'Setup',
    [activeModule]
  );

  // ── Sidebar nav item ──────────────────────────────────────────────────────
  const NavButton: React.FC<{ module: AnalysisType; onClose?: () => void }> = ({ module, onClose }) => {
    const Icon    = MODULE_ICONS[module];
    const isActive = activeModule === module;
    const badge   = anomalyBadges[module];
    return (
      <button
        key={module}
        onClick={() => { switchModule(module); onClose?.(); }}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors group ${
          isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
      >
        <Icon size={15} className={`shrink-0 ${isActive ? 'text-blue-100' : 'text-slate-400 group-hover:text-slate-200'}`} />
        <span className="text-[13px] leading-tight flex-1 text-left">{MODULE_LABELS[module]}</span>
        {badge != null && badge > 0 && (
          <span className={`badge-pop shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
            isActive ? 'bg-white/20 text-white' : 'bg-red-500 text-white'
          }`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    );
  };

  const SidebarContent: React.FC<{ isMobile?: boolean; onClose?: () => void }> = ({ isMobile = false, onClose }) => {
    const searchTerm = sidebarSearch.toLowerCase();
    const filteredSections = useMemo(() => {
      if (!searchTerm) return MODULE_SECTIONS;
      return MODULE_SECTIONS.map((s) => ({
        ...s,
        modules: s.modules.filter((m) => MODULE_LABELS[m].toLowerCase().includes(searchTerm)),
      })).filter((s) => s.modules.length > 0);
    }, [searchTerm]);

    const showRecent = !searchTerm && recentModules.length > 0;

    return (
      <>
        {/* Brand header */}
        <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-400" />
            FinAnalyzer
          </h1>
          {isMobile && (
            <button onClick={onClose} aria-label="Close navigation"
              className="text-slate-300 hover:text-white p-1 rounded-md hover:bg-slate-800">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Search modules…"
              className="w-full bg-slate-800 text-slate-200 placeholder-slate-500 text-[13px] pl-7 pr-8 py-1.5 rounded-md border border-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {sidebarSearch ? (
              <button onClick={() => setSidebarSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X size={12} />
              </button>
            ) : (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 bg-slate-700 px-1 rounded">⌘K</kbd>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Audit modules">
          {/* Recently used */}
          {showRecent && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 px-2 mb-1.5">
                <History size={11} className="text-slate-500" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recent</span>
              </div>
              <div className="space-y-0.5">
                {recentModules.map((m) => <NavButton key={m} module={m} onClose={onClose} />)}
              </div>
            </div>
          )}

          {/* Sections */}
          {filteredSections.map((section) => (
            <div key={section.id} className="mb-4">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.modules.map((m) => <NavButton key={m} module={m} onClose={onClose} />)}
              </div>
            </div>
          ))}

          {filteredSections.length === 0 && (
            <p className="px-3 py-6 text-center text-slate-500 text-sm">No modules match "{sidebarSearch}"</p>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 space-y-1">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] text-slate-500">
              {dashboardSummary.totalRows > 0 ? `${dashboardSummary.totalRows.toLocaleString()} records` : 'No data'}
            </span>
            <button onClick={() => setDarkMode((d) => !d)} title={darkMode ? 'Light mode' : 'Dark mode'}
              className="text-slate-400 hover:text-slate-200 p-1 rounded transition-colors">
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          <button
            onClick={() => { resetDataset(); onClose?.(); }}
            className="w-full flex items-center gap-2 text-[13px] text-slate-400 hover:text-white transition-colors px-2 py-1.5 rounded hover:bg-slate-800"
          >
            <ArrowLeft size={14} />
            Change File
          </button>
        </div>
      </>
    );
  };

  const Sidebar = () => (
    <aside className="w-72 bg-slate-900 text-white fixed inset-y-0 left-0 hidden lg:flex flex-col overflow-hidden z-20">
      <SidebarContent />
    </aside>
  );

  const DashboardPreview = () => {
    const totalRows      = dashboardSummary.totalRows;
    const uniqueVouchers = dashboardSummary.uniqueVouchers;
    const dateStart      = dashboardSummary.minDate;
    const dateEnd        = dashboardSummary.maxDate;

    // Aggregate badge counts per section for the audit readiness panel
    const sectionAnomalies = useMemo(() =>
      MODULE_SECTIONS.map((s) => {
        const flags = s.modules.reduce((sum, m) => sum + (anomalyBadges[m] ?? 0), 0);
        const lastVisit = s.modules.map((m) => getLastRun(m)).filter(Boolean)[0] ?? null;
        return { ...s, flags, lastVisit };
      }),
    []);

    const totalFlags = Object.values(anomalyBadges).reduce((a, b) => a + b, 0);
    const modulesRun = Object.keys(lastRunMap).length;

    return (
      <div className="space-y-6 max-w-5xl">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Ledger Entries',    value: totalRows.toLocaleString('en-IN'),      color: 'text-slate-800' },
            { label: 'Unique Vouchers',   value: uniqueVouchers.toLocaleString('en-IN'), color: 'text-blue-600'  },
            { label: 'From',              value: dateStart || '—',                        color: 'text-slate-700' },
            { label: 'To',                value: dateEnd   || '—',                        color: 'text-slate-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Audit readiness + quick actions */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Left — section status */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <span className="font-semibold text-slate-700 text-sm">Audit Readiness</span>
              {totalFlags > 0 ? (
                <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {totalFlags} flag{totalFlags > 1 ? 's' : ''}
                </span>
              ) : modulesRun > 0 ? (
                <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                  All clear
                </span>
              ) : null}
            </div>
            <div className="divide-y divide-slate-50">
              {sectionAnomalies.filter(s => s.id !== 'setup').map((s) => (
                <button
                  key={s.id}
                  onClick={() => switchModule(s.modules[0])}
                  className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 transition-colors text-left"
                >
                  {s.flags > 0 ? (
                    <AlertCircle size={15} className="shrink-0 text-red-500" />
                  ) : s.lastVisit ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  ) : (
                    <div className="w-[15px] h-[15px] rounded-full border-2 border-slate-200 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-700 font-medium">{s.title}</span>
                    {s.lastVisit && (
                      <span className="ml-2 text-[11px] text-slate-400">{formatLastRun(s.lastVisit)}</span>
                    )}
                  </div>
                  {s.flags > 0 && (
                    <span className="shrink-0 text-[11px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                      {s.flags}
                    </span>
                  )}
                  <ChevronRight size={13} className="shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          </div>

          {/* Right — quick actions */}
          <div className="space-y-3">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl p-5 text-white shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} className="text-blue-200" />
                <span className="font-semibold text-sm">Quick Start</span>
              </div>
              <p className="text-blue-100 text-xs mb-4 leading-relaxed">
                {modulesRun === 0
                  ? 'Configure ledger mappings first, then run your highest-priority checks.'
                  : `${modulesRun} module${modulesRun > 1 ? 's' : ''} run so far. ${totalFlags > 0 ? `${totalFlags} flag${totalFlags > 1 ? 's' : ''} need attention.` : 'Looking good!'}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Audit Setup',      module: AnalysisType.AUDIT_CONFIG          },
                  { label: 'TDS Analysis',      module: AnalysisType.TDS_ANALYSIS          },
                  { label: 'GSTR-2B Recon',     module: AnalysisType.GSTR2B_RECONCILIATION },
                  { label: 'Party Matrix',      module: AnalysisType.PARTY_LEDGER_MATRIX   },
                ].map(({ label, module }) => (
                  <button
                    key={module}
                    onClick={() => switchModule(module)}
                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-2 rounded-lg text-left transition-colors flex items-center justify-between"
                  >
                    {label}
                    <ChevronRight size={12} className="opacity-60" />
                  </button>
                ))}
              </div>
            </div>

            {/* Data mode card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-start gap-3">
              <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${isSqlMode ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <div>
                <p className="text-sm font-medium text-slate-700">
                  {isSqlMode ? 'SQL Mode (low-memory)' : 'In-memory Mode'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSqlMode
                    ? 'Data is served from SQLite — large files are fully supported.'
                    : 'Data is held in RAM. For large TSF files enable the desktop backend.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!hasDataset) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6">
           <div className="max-w-7xl mx-auto flex items-center gap-2">
             <BarChart3 className="text-blue-600" />
             <span className="font-bold text-xl text-slate-900">FinAnalyzer Pro</span>
           </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <FileUpload onDataLoaded={handleDataLoaded} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-950/50"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(85vw,22rem)] bg-slate-900 text-white shadow-2xl flex flex-col">
            <SidebarContent isMobile onClose={() => setIsMobileNavOpen(false)} />
          </aside>
        </div>
      )}
      <Sidebar />
      <div className="flex-1 lg:ml-72 transition-all">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 py-2.5 md:px-6 lg:px-8 flex items-center gap-3">
          {/* Mobile menu */}
          <button
            onClick={() => setIsMobileNavOpen(true)}
            className="lg:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu size={16} />
          </button>
          {/* Title + last-run */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-800 truncate">
                {MODULE_LABELS[activeModule] || 'Dashboard Overview'}
              </h2>
              {activeModule !== AnalysisType.DASHBOARD && (lastRunMap[activeModule] || getLastRun(activeModule)) && (
                <span className="text-[11px] text-slate-400 shrink-0">
                  Last run {formatLastRun(lastRunMap[activeModule] ?? getLastRun(activeModule))}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">{activeSection}</p>
          </div>
          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportSourceFile}
              disabled={!hasDataset}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                hasDataset
                  ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <Download size={13} />
              Export TSF
            </button>
            <div className="hidden md:block text-right">
              <div className="text-xs text-slate-500 leading-tight">{dashboardSummary.totalRows.toLocaleString()} entries</div>
              <div className={`text-[11px] leading-tight ${isSqlMode ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isSqlMode ? 'SQL mode' : 'In-memory'}
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          {updateAvailable && (
            <div className="mb-4 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm flex items-center justify-between gap-3">
              <span>A new version <strong>v{updateAvailable}</strong> is available.</span>
              <button onClick={() => setUpdateAvailable(null)} className="text-blue-600 hover:text-blue-800 font-bold text-xs shrink-0">Dismiss</button>
            </div>
          )}
          {sqlNote && (
            <div className="mb-4 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm">
              {sqlNote}
            </div>
          )}
          {isSqlMode && isModuleDataLoading && activeModule !== AnalysisType.DASHBOARD ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <ModuleSkeleton />
            </div>
          ) : (
            <Suspense fallback={
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <ModuleSkeleton />
              </div>
            }>

              {activeModule === AnalysisType.DASHBOARD && <DashboardPreview />}
              {activeModule === AnalysisType.AUDIT_CONFIG && (
                <AuditSetup data={transactionData} settings={settings} onUpdate={updateSettings} />
              )}
              {activeModule === AnalysisType.TRIAL_BALANCE && <TrialBalanceAnalysis data={data} />}
              {activeModule === AnalysisType.DEBTOR_AGEING && <DebtorAgeingFIFO data={transactionData} />}
              {activeModule === AnalysisType.CREDITOR_AGEING && <CreditorAgeingFIFO data={transactionData} />}
              {activeModule === AnalysisType.GST_RATE && (
                <GSTRateAnalysis
                  data={transactionData}
                  externalSelectedLedgers={settings.salesGstLedgers}
                  onLedgersUpdate={(l) => updateSettings({ salesGstLedgers: l })}
                />
              )}
              {activeModule === AnalysisType.SALES_REGISTER && (
                <SalesRegister data={transactionData} externalSelectedLedgers={settings.salesGstLedgers} />
              )}
              {activeModule === AnalysisType.PURCHASE_GST_REGISTER && (
                <PurchaseGSTRegister
                  data={transactionData}
                  externalSelectedLedgers={settings.purchaseGstLedgers}
                  externalRcmLedgers={settings.rcmTaxLedgers}
                  onLedgersUpdate={(l) => updateSettings({ purchaseGstLedgers: l })}
                />
              )}
              {activeModule === AnalysisType.GSTR2B_RECONCILIATION && (
                <GSTR2BReconciliation
                  data={transactionData}
                  selectedGstLedgers={settings.purchaseGstLedgers}
                  selectedRcmLedgers={settings.rcmTaxLedgers}
                />
              )}
              {activeModule === AnalysisType.ITC_3B_RECONCILIATION && (
                <ITC3BReconciliation
                  data={transactionData}
                  externalSelectedLedgers={settings.purchaseGstLedgers}
                  externalRcmLedgers={settings.rcmTaxLedgers}
                  onLedgersUpdate={(l) => updateSettings({ purchaseGstLedgers: l })}
                />
              )}
              {activeModule === AnalysisType.TDS_ANALYSIS && (
                <TDSAnalysis
                  data={transactionData}
                  externalSelectedLedgers={settings.tdsTaxLedgers}
                  onLedgersUpdate={(l) => updateSettings({ tdsTaxLedgers: l })}
                  thresholdConfig={settings.tdsThresholdConfig}
                  onThresholdConfigUpdate={(cfg) => updateSettings({ tdsThresholdConfig: cfg })}
                  annotations={settings.tdsAnnotations}
                  onAnnotationsUpdate={(notes) => updateSettings({ tdsAnnotations: notes })}
                  isSqlMode={isSqlMode}
                />
              )}
              {activeModule === AnalysisType.RCM_ANALYSIS && (
                <RCMAnalysis
                  data={transactionData}
                  externalSelectedLedgers={settings.rcmTaxLedgers}
                  onLedgersUpdate={(l) => updateSettings({ rcmTaxLedgers: l })}
                />
              )}
              {activeModule === AnalysisType.GST_EXPENSE_ANALYSIS && (
                <GSTExpenseAnalysis
                  data={transactionData}
                  externalSelectedLedgers={settings.blockedCreditLedgers}
                  onLedgersUpdate={(l) => updateSettings({ blockedCreditLedgers: l })}
                />
              )}
              {activeModule === AnalysisType.PROFIT_LOSS_ANALYSIS && <ProfitLossAnalysis data={transactionData} />}
              {activeModule === AnalysisType.CASH_FLOW_ANALYSIS && <CashFlowAnalysis data={transactionData} />}
              {activeModule === AnalysisType.VARIANCE_ANALYSIS && <VarianceAnalysis data={transactionData} />}
              {activeModule === AnalysisType.EXCEPTION_DENSITY_HEATMAP && (
                <ExceptionDensityHeatmapAnalytics data={transactionData} />
              )}
              {activeModule === AnalysisType.BALANCE_SHEET_CLEANLINESS && (
                <BalanceSheetCleanlinessAnalytics data={transactionData} />
              )}
              {activeModule === AnalysisType.ORPHAN_PL_VOUCHERS && (
                <OrphanPLVouchers data={transactionData} />
              )}
              {activeModule === AnalysisType.TSF_COMPARISON && <TSFComparison />}
              {activeModule === AnalysisType.LEDGER_ANALYTICS && <LedgerAnalytics data={transactionData} />}
              {activeModule === AnalysisType.VOUCHER_BOOK_VIEW && <VoucherBookView data={transactionData} />}
              {activeModule === AnalysisType.LEDGER_VOUCHER_VIEW && <LedgerVoucherView data={transactionData} />}
              {activeModule === AnalysisType.PARTY_LEDGER_MATRIX && (
                <PartyLedgerMatrix
                  data={data}
                  externalProfile={settings.partyMatrixProfile}
                  onProfileUpdate={(profile) => updateSettings({ partyMatrixProfile: profile })}
                />
              )}
              {activeModule === AnalysisType.RELATED_PARTY_ANALYSIS && (
                <RelatedPartyAnalysis
                  data={transactionData}
                  externalProfile={settings.relatedPartyProfile}
                  onProfileUpdate={(profile) => updateSettings({ relatedPartyProfile: profile })}
                />
              )}
              {activeModule === AnalysisType.GST_LEDGER_SUMMARY && (
                <GSTLedgerSummary
                  data={transactionData}
                  externalSelectedLedgers={settings.gstLedgerSummary}
                  onLedgersUpdate={(l) => updateSettings({ gstLedgerSummary: l })}
                />
              )}
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
