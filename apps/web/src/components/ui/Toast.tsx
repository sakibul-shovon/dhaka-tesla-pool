import { createContext, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastTone = "success" | "warning" | "danger" | "neutral";

interface ToastInput {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TONE_ICON: Record<ToastTone, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Info,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  neutral: "border-border bg-surface text-text",
};

let nextToastId = 0;

// One provider for the whole app (plan §1/§15.1: 409s and session expiry
// need a toast, and nothing existed to render one). Mounted once in
// AppProviders so any screen can call useToast() without its own portal.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, tone = "neutral", durationMs = 4000 }: ToastInput) => {
      const id = nextToastId++;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = TONE_ICON[toast.tone];
            return (
              <motion.div
                key={toast.id}
                role="status"
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium shadow-lg ${TONE_CLASSES[toast.tone]}`}
              >
                <Icon size={17} strokeWidth={2.25} className="mt-0.5 flex-none" />
                <span className="flex-1">{toast.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="flex-none rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X size={14} strokeWidth={2.25} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
