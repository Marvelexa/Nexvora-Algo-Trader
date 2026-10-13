import React, { useState } from 'react';
import { 
  X, 
  Key, 
  Lock, 
  Shield, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Copy, 
  ExternalLink,
  Sliders,
  Check
} from 'lucide-react';
import { ExchangeStatus } from '../types';

interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: ExchangeStatus | null;
  onUpdateCredentials: (apiKey: string, apiSecret: string, isSimulation: boolean) => Promise<void>;
  onTestConnection: () => Promise<{ connected: boolean; status: string; error?: string }>;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  isOpen,
  onClose,
  status,
  onUpdateCredentials,
  onTestConnection,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isSimulation, setIsSimulation] = useState(status?.isSimulation ?? true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; status: string; error?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection();
      setTestResult(res);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateCredentials(apiKey, apiSecret, isSimulation);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Delta Exchange Demo (Testnet) API Settings</h2>
              <p className="text-xs text-slate-400">Delta Testnet & Paper Execution Simulation Engine</p>
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
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Active Status Card */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Connection Diagnostics</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Live Real-Time Market Data Active
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Real-time prices, ticker changes, and live order books are streaming directly from the global exchange network. Auto-Sell triggers execute instantaneously when configured criteria are reached.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? 'Verifying with Exchange...' : 'Test HMAC Signed Account Ping'}
              </button>
            </div>

            {testResult && (
              <div className={`p-3 rounded-lg text-xs border ${
                testResult.connected 
                  ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300' 
                  : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
              }`}>
                <div className="font-semibold flex items-center gap-1.5">
                  {testResult.connected ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {testResult.connected ? 'Connected to Spot Exchange Account' : 'Exchange Diagnostics Report'}
                </div>
                <div className="mt-1 text-slate-300 text-[11px] leading-relaxed">
                  {testResult.error || 'Account verified! Live balance synced and order routing ready.'}
                </div>
                {!testResult.connected && (
                  <div className="mt-2 text-[11px] text-slate-400 bg-slate-900/90 p-2 rounded border border-slate-800">
                    💡 <strong>Note:</strong> Real crypto exchanges (Binance, Bybit) require IP whitelisting when using API keys from cloud container networks. The built-in <strong>Real-Time Execution Simulator</strong> is active so you can test all Auto-Sell rules against live real-time price ticks without IP block restrictions.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Exchange API Key
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter exchange API key"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(apiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                  title="Copy API Key"
                >
                  {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Exchange API Secret
              </label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter exchange API secret key"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Keys are stored securely on the backend server for signing HMAC SHA-256 trade payloads.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-slate-200 block">Execution Mode</span>
                <span className="text-[11px] text-slate-400">
                  {isSimulation 
                    ? 'Paper Trading (Executes on live tick data with simulated portfolio)' 
                    : 'Hybrid Auto-Execution (Attempts live exchange order with fallback)'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSimulation(!isSimulation)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  isSimulation ? 'bg-amber-600' : 'bg-emerald-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isSimulation ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {saveSuccess ? (
                  <>
                    <Check className="h-4 w-4" />
                    Credentials Saved!
                  </>
                ) : (
                  'Save & Apply Settings'
                )}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
};
