import React, { useState, useEffect } from 'react';
import { 
  Key, 
  Check, 
  Copy, 
  HardDrive, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Zap, 
  FlaskConical, 
  ShieldCheck, 
  Globe, 
  Building2 
} from 'lucide-react';
import { ExchangeStatus } from '../types';

interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: ExchangeStatus | null;
  onUpdateCredentials: (payload: {
    activeMode?: string;
    tradingMode?: string;
    demoApiKey?: string;
    demoApiSecret?: string;
    liveApiKey?: string;
    liveApiSecret?: string;
    liveRegion?: 'INDIA' | 'GLOBAL';
    apiKey?: string;
    apiSecret?: string;
    isSimulation?: boolean;
  }) => Promise<void>;
  onTestConnection: (options?: {
    target?: 'demo' | 'live' | 'active';
    apiKey?: string;
    apiSecret?: string;
    endpoint?: string;
    region?: 'INDIA' | 'GLOBAL';
  }) => Promise<{
    connected: boolean;
    status: string;
    error?: string;
    balances?: any[];
    clientIp?: string;
    netEquityUSD?: string;
    exchange?: string;
  }>;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  isOpen,
  onClose,
  status,
  onUpdateCredentials,
  onTestConnection,
}) => {
  const initialMode = status?.activeMode || status?.tradingMode || (status?.isSimulation ? 'SIMULATION_PAPER' : (status?.isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA'));
  
  const [activeMode, setActiveMode] = useState<'DELTA_TESTNET' | 'LIVE_DELTA_INDIA' | 'LIVE_DELTA_GLOBAL' | 'SIMULATION_PAPER'>(
    (initialMode as any) || 'DELTA_TESTNET'
  );

  // Demo Delta State
  const [demoApiKey, setDemoApiKey] = useState('');
  const [demoApiSecret, setDemoApiSecret] = useState('');
  const [isTestingDemo, setIsTestingDemo] = useState(false);
  const [demoTestResult, setDemoTestResult] = useState<any>(null);

  // Normal Live Delta State
  const [liveApiKey, setLiveApiKey] = useState('');
  const [liveApiSecret, setLiveApiSecret] = useState('');
  const [liveRegion, setLiveRegion] = useState<'INDIA' | 'GLOBAL'>(
    status?.live?.region || (initialMode === 'LIVE_DELTA_GLOBAL' ? 'GLOBAL' : 'INDIA')
  );
  const [isTestingLive, setIsTestingLive] = useState(false);
  const [liveTestResult, setLiveTestResult] = useState<any>(null);

  // UI state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (status?.activeMode || status?.tradingMode) {
      setActiveMode((status.activeMode || status.tradingMode) as any);
    }
    if (status?.live?.region) {
      setLiveRegion(status.live.region);
    }
  }, [status]);

  if (!isOpen) return null;

  // Test Demo Delta connection
  const handleTestDemo = async () => {
    setIsTestingDemo(true);
    setDemoTestResult(null);
    try {
      const res = await onTestConnection({
        target: 'demo',
        apiKey: demoApiKey ? demoApiKey.trim() : undefined,
        apiSecret: demoApiSecret ? demoApiSecret.trim() : undefined,
      });
      setDemoTestResult(res);
    } catch (err: any) {
      setDemoTestResult({
        connected: false,
        status: 'CONNECTION_FAILED',
        error: err.message || 'Network error connecting to Demo Delta testnet',
      });
    } finally {
      setIsTestingDemo(false);
    }
  };

  // Test Normal Live Delta connection
  const handleTestLive = async () => {
    setIsTestingLive(true);
    setLiveTestResult(null);
    try {
      const res = await onTestConnection({
        target: 'live',
        apiKey: liveApiKey ? liveApiKey.trim() : undefined,
        apiSecret: liveApiSecret ? liveApiSecret.trim() : undefined,
        region: liveRegion,
      });
      setLiveTestResult(res);
    } catch (err: any) {
      setLiveTestResult({
        connected: false,
        status: 'CONNECTION_FAILED',
        error: err.message || 'Network error connecting to Normal Live Delta',
      });
    } finally {
      setIsTestingLive(false);
    }
  };

  // Save both Demo and Normal Delta settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const isSim = activeMode === 'SIMULATION_PAPER';
      const effectiveMode = activeMode === 'LIVE_DELTA_INDIA' && liveRegion === 'GLOBAL' ? 'LIVE_DELTA_GLOBAL' : activeMode;

      await onUpdateCredentials({
        activeMode: effectiveMode,
        tradingMode: effectiveMode,
        demoApiKey: demoApiKey.trim() || undefined,
        demoApiSecret: demoApiSecret.trim() || undefined,
        liveApiKey: liveApiKey.trim() || undefined,
        liveApiSecret: liveApiSecret.trim() || undefined,
        liveRegion,
        isSimulation: isSim,
      });

      setSaveSuccess(true);
      setDemoApiKey('');
      setDemoApiSecret('');
      setLiveApiKey('');
      setLiveApiSecret('');
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isDemoActive = activeMode === 'DELTA_TESTNET';
  const isLiveActive = activeMode === 'LIVE_DELTA_INDIA' || activeMode === 'LIVE_DELTA_GLOBAL';
  const isPaperActive = activeMode === 'SIMULATION_PAPER';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Delta Exchange Settings (Demo & Normal Delta)</h2>
              <p className="text-xs text-slate-400">Manage both Demo and Normal Live accounts side-by-side without editing .env after deploy</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">

          {/* Active System Storage Notice */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400 mt-0.5">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="text-xs space-y-0.5">
              <span className="font-semibold text-slate-200 block">Dual System Storage Active (.exchange_credentials.json)</span>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Both Demo and Normal Delta credentials are saved permanently on the server. You can switch between them with one click without re-entering keys or redeploying.
              </p>
            </div>
          </div>

          {/* Active Mode Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Select Active Trading Environment:
              </label>
              <span className="text-[11px] text-slate-400">
                Engine will place orders on this account
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* Option 1: Demo Delta */}
              <button
                type="button"
                onClick={() => setActiveMode('DELTA_TESTNET')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer relative ${
                  isDemoActive
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/50 shadow-md shadow-emerald-500/10'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                {isDemoActive && (
                  <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    ACTIVE
                  </span>
                )}
                <div className="font-semibold text-xs flex items-center gap-1.5 text-white">
                  <FlaskConical className={`h-4 w-4 ${isDemoActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  Demo Delta
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">Testnet Sandbox Account</span>
                <span className="text-[9px] font-mono text-emerald-400/80 block mt-0.5">testnet.deltaex.org</span>
              </button>

              {/* Option 2: Normal Live Delta */}
              <button
                type="button"
                onClick={() => setActiveMode(liveRegion === 'GLOBAL' ? 'LIVE_DELTA_GLOBAL' : 'LIVE_DELTA_INDIA')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer relative ${
                  isLiveActive
                    ? 'bg-rose-500/15 border-rose-500 text-rose-300 ring-1 ring-rose-500/50 shadow-md shadow-rose-500/10'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                {isLiveActive && (
                  <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    ACTIVE
                  </span>
                )}
                <div className="font-semibold text-xs flex items-center gap-1.5 text-white">
                  <Zap className={`h-4 w-4 ${isLiveActive ? 'text-rose-400' : 'text-slate-400'}`} />
                  Normal Delta
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">Real Money Production</span>
                <span className="text-[9px] font-mono text-rose-400/80 block mt-0.5">
                  {liveRegion === 'GLOBAL' ? 'api.delta.exchange' : 'api.india.delta.exchange'}
                </span>
              </button>

              {/* Option 3: Paper Mode */}
              <button
                type="button"
                onClick={() => setActiveMode('SIMULATION_PAPER')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer relative ${
                  isPaperActive
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300 ring-1 ring-amber-500/50 shadow-md shadow-amber-500/10'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                {isPaperActive && (
                  <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    ACTIVE
                  </span>
                )}
                <div className="font-semibold text-xs flex items-center gap-1.5 text-white">
                  <ShieldCheck className={`h-4 w-4 ${isPaperActive ? 'text-amber-400' : 'text-slate-400'}`} />
                  Paper Mode
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">Local Virtual Fills</span>
                <span className="text-[9px] font-mono text-amber-400/80 block mt-0.5">Zero financial risk</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">

            {/* ======================================================== */}
            {/* OPTION A: DEMO DELTA (TESTNET) CONFIGURATION */}
            {/* ======================================================== */}
            <div className={`p-4 rounded-xl border transition-all ${
              isDemoActive 
                ? 'bg-slate-950/90 border-emerald-500/50 ring-1 ring-emerald-500/20' 
                : 'bg-slate-950/60 border-slate-800/80'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <FlaskConical className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                      1. Demo Delta (Testnet) Credentials
                      {isDemoActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-normal">
                          Currently Active
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-400">Endpoint: https://cdn-ind.testnet.deltaex.org</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Saved Demo Key:</span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    {status?.demo?.maskedApiKey || (status?.isTestnet ? status?.maskedApiKey : 'NOT_SET')}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {/* Demo API Key */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Demo API Key
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={demoApiKey}
                      onChange={(e) => setDemoApiKey(e.target.value)}
                      placeholder={
                        status?.demo?.maskedApiKey 
                          ? `Keep current (${status.demo.maskedApiKey}) or enter new` 
                          : "Enter Demo Delta API Key"
                      }
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                    {demoApiKey && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(demoApiKey, 'demo')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                      >
                        {copiedKey === 'demo' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Demo API Secret */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Demo API Secret
                  </label>
                  <input
                    type="password"
                    value={demoApiSecret}
                    onChange={(e) => setDemoApiSecret(e.target.value)}
                    placeholder={
                      status?.demo?.hasApiSecret 
                        ? "Keep current secret or enter new" 
                        : "Enter Demo Delta API Secret"
                    }
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Demo Test Button & Diagnostics */}
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-400">
                  Tests HMAC connection directly to Demo Testnet
                </span>
                <button
                  type="button"
                  onClick={handleTestDemo}
                  disabled={isTestingDemo}
                  className="px-3 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${isTestingDemo ? 'animate-spin' : ''}`} />
                  {isTestingDemo ? 'Testing Demo...' : 'Test Demo Connection'}
                </button>
              </div>

              {/* Demo Test Result */}
              {demoTestResult && (
                <div className={`mt-2.5 p-3 rounded-lg border text-xs ${
                  demoTestResult.connected
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-800 text-amber-300'
                }`}>
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5">
                      {demoTestResult.connected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                      {demoTestResult.connected ? 'Demo Delta Connected Successfully!' : 'Demo Test Failed'}
                    </span>
                    {demoTestResult.netEquityUSD && (
                      <span className="font-mono bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded text-[11px]">
                        Demo Equity: ${demoTestResult.netEquityUSD} USD
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">
                    {demoTestResult.error ? `Error: ${demoTestResult.error}` : 'Demo balances & HMAC signature verified.'}
                  </p>
                  {demoTestResult.clientIp && (
                    <div className="mt-1.5 flex items-center justify-between bg-slate-900/90 p-1.5 rounded text-[10px]">
                      <span>Server IP for Whitelisting: <strong className="font-mono text-white">{demoTestResult.clientIp}</strong></span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(demoTestResult.clientIp, 'ip-demo')}
                        className="text-blue-400 hover:underline"
                      >
                        {copiedKey === 'ip-demo' ? 'Copied' : 'Copy IP'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ======================================================== */}
            {/* OPTION B: NORMAL DELTA (LIVE) CONFIGURATION */}
            {/* ======================================================== */}
            <div className={`p-4 rounded-xl border transition-all ${
              isLiveActive 
                ? 'bg-slate-950/90 border-rose-500/50 ring-1 ring-rose-500/20' 
                : 'bg-slate-950/60 border-slate-800/80'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                      2. Normal Delta (Live Real Money) Credentials
                      {isLiveActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-normal">
                          Currently Active
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {liveRegion === 'GLOBAL' ? 'Endpoint: https://api.delta.exchange' : 'Endpoint: https://api.india.delta.exchange'}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Saved Live Key:</span>
                  <span className="text-[11px] font-mono text-rose-400">
                    {status?.live?.maskedApiKey || (!status?.isTestnet ? status?.maskedApiKey : 'NOT_SET')}
                  </span>
                </div>
              </div>

              {/* Region Selector */}
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[11px] font-medium text-slate-300">Live Region:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLiveRegion('INDIA');
                      if (isLiveActive) setActiveMode('LIVE_DELTA_INDIA');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                      liveRegion === 'INDIA'
                        ? 'bg-rose-500/20 border-rose-500/60 text-rose-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Delta India (india.delta.exchange)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLiveRegion('GLOBAL');
                      if (isLiveActive) setActiveMode('LIVE_DELTA_GLOBAL');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                      liveRegion === 'GLOBAL'
                        ? 'bg-rose-500/20 border-rose-500/60 text-rose-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Delta Global (delta.exchange)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {/* Normal Live API Key */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Normal Live API Key
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={liveApiKey}
                      onChange={(e) => setLiveApiKey(e.target.value)}
                      placeholder={
                        status?.live?.maskedApiKey 
                          ? `Keep current (${status.live.maskedApiKey}) or enter new` 
                          : "Enter Normal Live API Key"
                      }
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                    />
                    {liveApiKey && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(liveApiKey, 'live')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                      >
                        {copiedKey === 'live' ? <Check className="h-3 w-3 text-rose-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Normal Live API Secret */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Normal Live API Secret
                  </label>
                  <input
                    type="password"
                    value={liveApiSecret}
                    onChange={(e) => setLiveApiSecret(e.target.value)}
                    placeholder={
                      status?.live?.hasApiSecret 
                        ? "Keep current secret or enter new" 
                        : "Enter Normal Live API Secret"
                    }
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Live Test Button & Diagnostics */}
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-400">
                  Tests HMAC connection directly to Real Money Live Delta
                </span>
                <button
                  type="button"
                  onClick={handleTestLive}
                  disabled={isTestingLive}
                  className="px-3 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${isTestingLive ? 'animate-spin' : ''}`} />
                  {isTestingLive ? 'Testing Live...' : 'Test Normal Live Connection'}
                </button>
              </div>

              {/* Live Test Result */}
              {liveTestResult && (
                <div className={`mt-2.5 p-3 rounded-lg border text-xs ${
                  liveTestResult.connected
                    ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                    : 'bg-amber-950/40 border-amber-800 text-amber-300'
                }`}>
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5">
                      {liveTestResult.connected ? <CheckCircle2 className="h-3.5 w-3.5 text-rose-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                      {liveTestResult.connected ? 'Normal Delta Live Connected Successfully!' : 'Live Connection Failed'}
                    </span>
                    {liveTestResult.netEquityUSD && (
                      <span className="font-mono bg-rose-500/20 text-rose-200 px-2 py-0.5 rounded text-[11px]">
                        Live Equity: ${liveTestResult.netEquityUSD} USD
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">
                    {liveTestResult.error ? `Error: ${liveTestResult.error}` : 'Real money production account verified & authorized.'}
                  </p>
                  {liveTestResult.clientIp && (
                    <div className="mt-1.5 flex items-center justify-between bg-slate-900/90 p-1.5 rounded text-[10px]">
                      <span>Server IP for Whitelisting: <strong className="font-mono text-white">{liveTestResult.clientIp}</strong></span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(liveTestResult.clientIp, 'ip-live')}
                        className="text-blue-400 hover:underline"
                      >
                        {copiedKey === 'ip-live' ? 'Copied' : 'Copy IP'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                {saveSuccess ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                    <Check className="h-4 w-4" />
                    Configuration saved & applied immediately without server restart!
                  </span>
                ) : (
                  'Both Demo & Normal Delta credentials persist permanently'
                )}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {isSaving ? 'Saving & Applying...' : 'Save & Apply Configuration'}
                </button>
              </div>
            </div>

          </form>

        </div>

      </div>
    </div>
  );
};
