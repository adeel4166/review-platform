"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/i18n/en";

export type ToastVariant = "success" | "info" | "warning" | "error";
interface ToastItem { id: number; variant: ToastVariant; message: string }
const Ctx = createContext<(variant: ToastVariant, message: string) => void>(() => undefined);
const tone: Record<ToastVariant, string> = { success: "bg-success-bg text-success", info: "bg-info-bg text-info", warning: "bg-warning-bg text-warning", error: "bg-danger-bg text-danger" };
const ttl: Record<ToastVariant, number | null> = { success: 5000, info: 5000, warning: 8000, error: null };

export function useToast() { return useContext(Ctx); }

function ToastView({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const paused = useRef(false);
  useEffect(() => {
    const ms = ttl[item.variant];
    if (ms === null) return;
    const h = setTimeout(() => { if (!paused.current) onClose(item.id); }, ms);
    return () => clearTimeout(h);
  }, [item, onClose]);
  return (
    <div role={item.variant === "error" ? "alert" : "status"} data-testid="toast"
      onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}
      className={`flex items-start gap-3 rounded-lg p-3 shadow-xl ${tone[item.variant]}`}>
      <p className="flex-1 text-sm font-medium">{item.message}</p>
      <button type="button" onClick={() => onClose(item.id)} aria-label={t("toast.dismiss")} className="inline-flex min-h-target min-w-target items-center justify-center rounded-md">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/** Region + hook. Newest on top, max 3. Never steals focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const close = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback((variant: ToastVariant, message: string) => {
    setItems((l) => [{ id: ++seq.current, variant, message }, ...l].slice(0, 3));
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 md:left-auto md:right-4 md:translate-x-0">
        {items.map((i) => <ToastView key={i.id} item={i} onClose={close} />)}
      </div>
    </Ctx.Provider>
  );
}
