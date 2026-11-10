import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  TrendingDown, 
  History, 
  FileSpreadsheet,
  ArrowDownRight,
  ArrowUpRight
} from 'lucide-react';
import { ExecutedOrder } from '../types';

interface ExecutionHistoryProps {
  orders: ExecutedOrder[];
  currency: 'USD' | 'INR';
  inrRate: number;
  onResetOrders?: () => void;
}

export const ExecutionHistory: React.FC<ExecutionHistoryProps> = React.memo(({
  orders,
  currency,
  inrRate,
  onResetOrders,
}) => {
  const formatMoney = (amount: number) => {
    const val = currency === 'INR' ? amount * inrRate : amount;
    const prefix = currency === 'INR' ? '₹' : '$';
    if (val >= 1000) return `${prefix}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${prefix}${val.toFixed(2)}`;
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <History className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Live Execution Audit Trail</h3>
            <p className="text-[11px] text-slate-400">Order fills & automated trigger events</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
            {orders.length} Executed Fills
          </span>
          {onResetOrders && orders.length > 0 && (
            <button
              onClick={onResetOrders}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 transition-all cursor-pointer"
              title="Clear execution audit history"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No executed orders logged yet. Active rules will display here as they fill.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-950/40">
                <th className="py-2.5 px-4">Time</th>
                <th className="py-2.5 px-4">Pair</th>
                <th className="py-2.5 px-4">Side & Type</th>
                <th className="py-2.5 px-4">Fill Price</th>
                <th className="py-2.5 px-4">Quantity</th>
                <th className="py-2.5 px-4">Total Value</th>
                <th className="py-2.5 px-4">Realized PnL</th>
                <th className="py-2.5 px-4">Trigger Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
              {orders.map((ord, idx) => {
                const isSell = ord.side === 'SELL';
                const hasPnl = ord.pnlPercent !== undefined && ord.pnlPercent !== 0;
                const isProfit = (ord.pnlPercent || 0) >= 0;

                return (
                  <tr key={`${ord.id || 'ord'}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                      {new Date(ord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-white">
                      {ord.symbol}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                        isSell 
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {isSell ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                        {ord.side} {ord.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-200">
                      ${ord.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">
                      {ord.quantity}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-100">
                      {formatMoney(ord.totalUsdt)}
                    </td>
                    <td className="py-2.5 px-4">
                      {hasPnl ? (
                        <span className={`font-bold flex items-center gap-0.5 ${
                          isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {isProfit ? '+' : ''}{ord.pnlPercent?.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-[11px] text-slate-300 font-sans max-w-xs truncate">
                      {ord.triggerReason}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
