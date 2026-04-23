import React, { useMemo, useState, useEffect } from 'react';
import { LedgerEntry } from '../../types';
import { getUniqueLedgers, exportToExcel } from '../../services/dataService';
import { Search, Filter, AlertTriangle, CheckCircle2, Download, ShieldCheck, Calculator, UserPlus, Info, ArrowRightLeft, ListFilter, ClipboardCheck, Ban, Zap, ChevronUp, ChevronDown, User, TrendingUp, History, FileText, PieChart, Settings } from 'lucide-react';
import { ResponsiveContainer, PieChart as RechartsPie, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface RelatedPartyAnalysisProps {
  data: LedgerEntry[];
  externalSelectedParties?: string[];
  onPartiesUpdate?: (parties: string[]) => void;
}

type Classification = 'Expense' | 'Sales' | 'Payment' | 'Receipt' | 'Loan' | 'Unclassified';

interface RPTTransaction {
  date: string;
  voucher_number: string;
  voucher_type: string;
  ledger: string;
  amount: number;
  type: 'Debit' | 'Credit';
  category: Classification;
  isUnusual: boolean;
  unusualReason: string[];
  narration: string;
}

interface PartySummary {
  name: string;
  relationship: string;
  opening: number;
  debits: number;
  credits: number;
  closing: number;
  isReconciled: boolean;
  transactions: RPTTransaction[];
  categoryBreakdown: Record<Classification, number>;
  exceptionCount: number;
}

const RPT_KEYWORDS = ['director', 'relative', 'associate', 'subsidiary', 'holding', 'partner', 'kmp', 'promoter'];
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#94a3b8'];

const RelatedPartyAnalysis: React.FC<RelatedPartyAnalysisProps> = ({ data, externalSelectedParties, onPartiesUpdate }) => {
  const [internalSelectedParties, setInternalSelectedParties] = useState<string[]>([]);
  const [relationships, setRelationships] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('rpt_relationships');
      return saved ? JSON.parse(saved) : {};
    } catch (e) { return {}; }
  });
  
  const selectedParties = externalSelectedParties || internalSelectedParties;
  const setSelectedParties = (l: string[] | ((prev: string[]) => string[])) => {
    if (onPartiesUpdate) {
      const nextValue = typeof l === 'function' ? l(selectedParties) : l;
      onPartiesUpdate(nextValue);
    } else {
      setInternalSelectedParties(l);
    }
  };

  useEffect(() => {
    localStorage.setItem('rpt_relationships', JSON.stringify(relationships));
  }, [relationships]);

  const [step, setStep] = useState<'config' | 'analysis'>('config');
  const [configSearch, setConfigSearch] = useState('');
  const [mainSearch, setMainSearch] = useState('');
  const [expandedParty, setExpandedParty] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'dashboard' | 'schedule'>('dashboard');
  const [highValueThreshold, setHighValueThreshold] = useState<number>(1000000);

  const allLedgers = useMemo(() => getUniqueLedgers(data), [data]);

  const rptAnalysis = useMemo(() => {
    if (selectedParties.length === 0) return [];

    const partyMap = new Map<string, PartySummary>();

    data.forEach(entry => {
      const isTagged = selectedParties.includes(entry.Ledger);
      if (!isTagged) return;

      const partyName = entry.Ledger;
      let summary = partyMap.get(partyName);
      
      if (!summary) {
        summary = {
          name: partyName,
          relationship: relationships[partyName] || 'Related Party',
          opening: entry.opening_balance || 0,
          debits: 0,
          credits: 0,
          closing: entry.closing_balance || 0,
          isReconciled: false,
          transactions: [],
          categoryBreakdown: { Expense: 0, Sales: 0, Payment: 0, Receipt: 0, Loan: 0, Unclassified: 0 },
          exceptionCount: 0
        };
        partyMap.set(partyName, summary);
      }

      const amount = entry.amount;
      if (amount > 0) summary.debits += amount; else summary.credits += Math.abs(amount);

      let category: Classification = 'Unclassified';
      const vType = (entry.voucher_type || '').toLowerCase();
      const primary = (entry.TallyPrimary || '').toLowerCase();
      const group = (entry.Group || '').toLowerCase();

      if (vType.includes('payment')) category = 'Payment';
      else if (vType.includes('receipt')) category = 'Receipt';
      else if (vType.includes('purchase') || primary.includes('expense') || group.includes('expense')) category = 'Expense';
      else if (vType.includes('sales') || primary.includes('income') || group.includes('income')) category = 'Sales';
      else if (primary.includes('loan') || group.includes('loan')) category = 'Loan';

      // AS-18 Logic: If unclassified, treat as Payment (Dr) or Receipt (Cr)
      if (category === 'Unclassified') {
        category = amount > 0 ? 'Payment' : 'Receipt';
      }

      summary.categoryBreakdown[category] += Math.abs(amount);

      const unusualReason: string[] = [];
      const absAmount = Math.abs(amount);
      if (absAmount >= highValueThreshold) unusualReason.push('High Value Transaction');
      if (absAmount > 0 && absAmount % 10000 === 0) unusualReason.push('Round Number Detected');
      
      const lastEntryDate = data.reduce((max, d) => d.date > max ? d.date : max, '');
      const cutoffDateObj = new Date(lastEntryDate);
      cutoffDateObj.setDate(cutoffDateObj.getDate() - 7);
      if (new Date(entry.date) >= cutoffDateObj) unusualReason.push('Close to period end');

      if (unusualReason.length > 0) summary.exceptionCount++;

      summary.transactions.push({
        date: entry.date,
        voucher_number: entry.voucher_number,
        voucher_type: entry.voucher_type,
        ledger: entry.Ledger,
        amount: absAmount,
        type: amount > 0 ? 'Debit' : 'Credit',
        category,
        isUnusual: unusualReason.length > 0,
        unusualReason,
        narration: entry.narration || ''
      });
    });

    return Array.from(partyMap.values()).map(s => ({
      ...s,
      isReconciled: Math.abs((s.opening + s.debits - s.credits) - s.closing) < 1
    }));
  }, [data, selectedParties, highValueThreshold, relationships]);

  const filteredAnalysis = useMemo(() => {
    return rptAnalysis.filter(p => p.name.toLowerCase().includes(mainSearch.toLowerCase()));
  }, [rptAnalysis, mainSearch]);

  const handleExport = () => {
    const exportData = filteredAnalysis.flatMap(p => p.transactions.map(t => ({
      'Party Name': p.name,
      'Relationship': p.relationship,
      'Date': t.date,
      'Voucher No': t.voucher_number,
      'Voucher Type': t.voucher_type,
      'Classification': t.category,
      'Debit (₹)': t.type === 'Debit' ? t.amount : 0,
      'Credit (₹)': t.type === 'Credit' ? t.amount : 0,
      'Audit Note': t.unusualReason.join(', '),
      'Narration': t.narration
    })));
    exportToExcel(exportData, `AS18_RPT_Schedule_${new Date().toISOString().slice(0, 10)}`);
  };

  if (step === 'config') {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-indigo-600 p-3 rounded-xl text-white shadow-lg"><UserPlus size={24} /></div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">AS-18 Setup: Identify Related Parties</h2>
              <p className="text-slate-500 font-medium">Select ledgers and define nature of relationships for official disclosures.</p>
            </div>
          </div>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-3 text-slate-400" size={20} />
              <input type="text" placeholder="Search ledgers..." className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500" value={configSearch} onChange={(e) => setConfigSearch(e.target.value)} />
            </div>
            <button onClick={() => setSelectedParties(allLedgers.filter(l => RPT_KEYWORDS.some(k => l.toLowerCase().includes(k))))} className="px-6 py-3 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold border border-indigo-200">Auto-Suggest</button>
          </div>
          <div className="max-h-[400px] overflow-y-auto border border-slate-100 rounded-2xl bg-slate-50/50 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {allLedgers.filter(l => !configSearch || l.toLowerCase().includes(configSearch.toLowerCase())).map(ledger => {
                const isSelected = selectedParties.includes(ledger);
                return (
                  <div key={ledger} onClick={() => setSelectedParties(prev => isSelected ? prev.filter(p => p !== ledger) : [...prev, ledger])} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between group ${isSelected ? 'border-indigo-600 bg-indigo-50 shadow-sm' : 'border-white bg-white hover:border-slate-200'}`}>
                    <span className={`text-sm font-bold truncate ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{ledger}</span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                      {isSelected && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-8 flex justify-end">
            <button onClick={() => setStep('analysis')} disabled={selectedParties.length === 0} className={`px-10 py-4 rounded-2xl font-black text-lg transition-all shadow-xl ${selectedParties.length > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>Generate Disclosure Schedules</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">RPT Disclosures</p>
          <div className="flex items-center gap-3"><p className="text-3xl font-black text-slate-900">{rptAnalysis.length}</p><User className="text-indigo-600" size={24} /></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Schedule Flags</p>
          <div className="flex items-center gap-3"><p className="text-3xl font-black text-red-600">{rptAnalysis.reduce((acc, p) => acc + p.exceptionCount, 0)}</p><AlertTriangle className="text-red-500" size={24} /></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Aggregate Volume</p>
          <div className="flex items-center gap-3"><p className="text-2xl font-black text-emerald-600">₹{rptAnalysis.reduce((acc, p) => acc + p.debits + p.credits, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <button onClick={() => setStep('config')} className="flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs hover:bg-slate-800 transition-all"><Settings size={14} /> Refine AS-18 Scope</button>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row justify-between items-center gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl w-full lg:w-auto">
          <button onClick={() => setViewMode('dashboard')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-tight flex items-center gap-2 transition-all ${viewMode === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}><PieChart size={14} /> Party Dashboard</button>
          <button onClick={() => setViewMode('schedule')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-tight flex items-center gap-2 transition-all ${viewMode === 'schedule' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}><FileText size={14} /> Audit Schedule</button>
        </div>
        <div className="flex items-center gap-3 flex-1 w-full lg:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input type="text" placeholder="Search disclosure schedule..." className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg" value={mainSearch} onChange={(e) => setMainSearch(e.target.value)} />
          </div>
          <button onClick={handleExport} className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 flex items-center gap-2 shadow-sm"><Download size={16} /> Export Master Schedule</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {filteredAnalysis.map((party) => {
          const isOpen = expandedParty === party.name;
          const chartData = (Object.entries(party.categoryBreakdown) as [Classification, number][])
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({ name, value }));

          return (
            <div key={party.name} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div 
                className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 cursor-pointer hover:bg-slate-50 transition-colors ${isOpen ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                onClick={() => setExpandedParty(isOpen ? null : party.name)}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={`p-4 rounded-full shrink-0 ${party.isReconciled ? 'bg-indigo-50 text-indigo-600' : 'bg-red-50 text-red-600'}`}><ShieldCheck size={32} /></div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900 text-xl tracking-tight uppercase truncate">{party.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <select 
                        value={party.relationship} 
                        onChange={(e) => {
                          e.stopPropagation();
                          setRelationships(prev => ({ ...prev, [party.name]: e.target.value }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] font-black text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 focus:outline-none"
                      >
                        <option value="Related Party">General Related Party</option>
                        <option value="Subsidiary">Subsidiary</option>
                        <option value="Associate">Associate</option>
                        <option value="KMP">KMP / Director</option>
                        <option value="Relative">Relative of KMP</option>
                      </select>
                      <span className="text-[10px] font-bold text-slate-400">• {party.transactions.length} Transactions</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-8 text-right shrink-0">
                  <div>
                    <p className="text-[10px] uppercase font-black text-slate-400 mb-1">Volume</p>
                    <p className="font-mono font-black text-slate-900 text-lg">₹{(party.debits + party.credits).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-black text-slate-400 mb-1">Balance</p>
                    <p className={`font-mono font-black text-lg ${party.closing < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                      ₹{Math.abs(party.closing).toLocaleString('en-IN', { maximumFractionDigits: 0 })} {party.closing < 0 ? 'Cr' : 'Dr'}
                    </p>
                  </div>
                  <div className="text-slate-400">{isOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}</div>
                </div>
              </div>

              {isOpen && (
                <div className="p-8 bg-white border-t border-slate-100 animate-in slide-in-from-top-2">
                  {viewMode === 'dashboard' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-2 space-y-6">
                        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><TrendingUp size={14} /> Transaction Mix (AS-18 Categories)</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {(Object.entries(party.categoryBreakdown) as [Classification, number][]).map(([cat, vol], idx) => vol > 0 && (
                              <div key={cat} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">{cat}</p>
                                <p className="font-mono font-bold text-slate-800">₹{vol.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                                <div className="h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length], width: `${(vol / (party.debits + party.credits)) * 100}%` }}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-indigo-900 text-white p-6 rounded-3xl shadow-xl shadow-indigo-200">
                          <h4 className="text-xs font-black opacity-50 uppercase tracking-widest mb-6">Financial Reconciliation</h4>
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 px-4">
                            <div className="text-center">
                              <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Opening</p>
                              <p className="text-xl font-mono font-black">₹{party.opening.toLocaleString('en-IN')}</p>
                            </div>
                            <div className="text-indigo-400"><History size={24} /></div>
                            <div className="text-center">
                              <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Net Flow</p>
                              <p className={`text-xl font-mono font-black ${party.debits > party.credits ? 'text-emerald-400' : 'text-red-400'}`}>
                                {party.debits > party.credits ? '+' : ''}{(party.debits - party.credits).toLocaleString('en-IN')}
                              </p>
                            </div>
                            <div className="text-indigo-400"><ArrowRightLeft size={24} /></div>
                            <div className="text-center">
                              <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Closing Balance</p>
                              <p className="text-2xl font-mono font-black border-b-4 border-white/20 pb-1">₹{party.closing.toLocaleString('en-IN')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex flex-col items-center justify-center">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Volume Distribution</h4>
                        <div className="h-48 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPie>
                              <Pie data={chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">
                                {chartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                              </Pie>
                              <Tooltip 
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                formatter={(val: number) => [`₹${val.toLocaleString()}`, 'Volume']}
                              />
                            </RechartsPie>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-4 w-full space-y-1">
                          {chartData.map((d, i) => (
                            <div key={d.name} className="flex items-center justify-between text-[10px]">
                              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div><span className="font-bold text-slate-500 uppercase">{d.name}</span></div>
                              <span className="font-mono font-bold text-slate-700">{((d.value / (party.debits + party.credits)) * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2"><ClipboardCheck size={18} className="text-indigo-600" /> Auditor's Disclosure Schedule</h4>
                        {party.exceptionCount > 0 && <span className="bg-red-50 text-red-700 text-[10px] font-black uppercase px-4 py-1.5 rounded-full border border-red-200 animate-pulse">{party.exceptionCount} Items for Review</span>}
                      </div>
                      <div className="overflow-x-auto rounded-2xl border border-slate-100">
                        <table className="w-full text-sm text-left border-collapse">
                          <thead className="bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest">
                            <tr>
                              <th className="px-6 py-4">Date</th>
                              <th className="px-6 py-4">Voucher No</th>
                              <th className="px-6 py-4">Type</th>
                              <th className="px-6 py-4">AS-18 Class</th>
                              <th className="px-6 py-4 text-right">Volume (₹)</th>
                              <th className="px-6 py-4">Audit Flags</th>
                              <th className="px-6 py-4">Narration</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {party.transactions.map((t, idx) => (
                              <tr key={idx} className={`hover:bg-slate-50 transition-colors ${t.isUnusual ? 'bg-red-50/20' : ''}`}>
                                <td className="px-6 py-4 font-bold text-slate-500">{t.date}</td>
                                <td className="px-6 py-4 font-bold text-slate-900">{t.voucher_number}</td>
                                <td className={`px-6 py-4 font-black text-[10px] uppercase ${t.type === 'Debit' ? 'text-indigo-600' : 'text-slate-400'}`}>{t.type}</td>
                                <td className="px-6 py-4">
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter border ${
                                    t.category === 'Expense' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                                    t.category === 'Sales' ? 'bg-green-50 text-green-600 border-green-100' : 
                                    t.category === 'Payment' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                    t.category === 'Receipt' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}>
                                    {t.category}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right font-mono font-black text-slate-800">₹{t.amount.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4">
                                  {t.isUnusual ? (
                                    <div className="space-y-1">
                                      {t.unusualReason.map(r => <span key={r} className="block text-[8px] font-black text-red-600 uppercase bg-red-100 px-2 py-0.5 rounded border border-red-200 w-fit">{r}</span>)}
                                    </div>
                                  ) : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-6 py-4 text-[11px] text-slate-400 italic max-w-xs truncate" title={t.narration}>{t.narration}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RelatedPartyAnalysis;