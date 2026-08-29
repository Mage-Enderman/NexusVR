import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { subscribeToToasts, dismiss, type ToastItem, type ToastKind } from '../services/ToastService.ts';

const KIND_STYLES: Record<ToastKind, { border: string; icon: React.ReactNode; bar: string }> = {
  success: {
    border: 'border-emerald-500/50',
    bar: 'bg-emerald-400',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
  },
  error: {
    border: 'border-rose-500/60',
    bar: 'bg-rose-400',
    icon: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
  },
  info: {
    border: 'border-cyan-500/50',
    bar: 'bg-cyan-400',
    icon: <Info className="w-4 h-4 text-cyan-300 shrink-0" />,
  },
};

/**
 * Fixed toast stack rendered bottom-center above the toolbar. Subscribes to
 * the module-level ToastService so any code path can raise notifications.
 * pointer-events-auto only on the cards themselves so it never blocks the
 * scene.
 */
export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]">
      {items.map((t) => {
        const s = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto w-full flex items-start gap-2.5 bg-slate-900/95 backdrop-blur-md border ${s.border} rounded-xl px-3 py-2.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2`}
            role="status"
          >
            <div className={`self-stretch w-0.5 rounded-full ${s.bar} shrink-0`} />
            <div className="flex-1 min-w-0 pt-0.5">
              <span className="text-xs leading-relaxed break-words text-slate-100">{t.message}</span>
            </div>
            {s.icon}
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
