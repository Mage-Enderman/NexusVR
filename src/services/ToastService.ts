/**
 * Minimal module-level toast service.
 *
 * Kept outside React so any code path (import handlers, network callbacks,
 * engine handlers) can raise user-visible notifications without prop drilling
 * or context wiring. `ToastHost` subscribes on mount and renders the stack.
 *
 * Usage:
 *   import { toast } from '../services/ToastService.ts';
 *   toast.error('Import failed: unsupported file');
 *   toast.success('Model imported');
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** ms before auto-dismiss; 0 = sticky (not used by default helpers). */
  duration: number;
}

type Listener = (items: ToastItem[]) => void;

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 4500;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

function push(kind: ToastKind, message: string, duration = DEFAULT_DURATION): number {
  const id = nextId++;
  items = [...items.slice(-(MAX_TOASTS - 1)), { id, kind, message, duration }];
  emit();
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );
  }
  return id;
}

export function dismiss(id: number) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  const before = items.length;
  items = items.filter((i) => i.id !== id);
  if (items.length !== before) emit();
}

export const toast = {
  success: (message: string, duration?: number) => push('success', message, duration),
  error: (message: string, duration?: number) => push('error', message, Math.max(duration ?? DEFAULT_DURATION, 6000)),
  info: (message: string, duration?: number) => push('info', message, duration),
  dismiss,
};

/** Subscribe to the toast stack. Returns an unsubscribe function. */
export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...items]);
  return () => listeners.delete(listener);
}
