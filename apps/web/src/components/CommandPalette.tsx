"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n/en";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/primitives/command";
import { DialogContent, DialogDescription, DialogRoot, DialogTitle } from "./ui/primitives/dialog";
import { ProductThumb, type ProductImageData } from "./ui/ProductCard";

interface Hit { id: string; slug: string; name: string; category: { name: string }; ratingAverage: unknown; ratingCount: number; primaryImage?: ProductImageData | null }
type State = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "done"; items: Hit[] };

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

/** Global command palette (shadcn Command over cmdk) backed by GET /api/products?q=. Server-side search, so cmdk's own filter is off. */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) { seq.current++; setState({ kind: "idle" }); return; }
    const ctrl = new AbortController();
    const id = ++seq.current;
    setState({ kind: "loading" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?${new URLSearchParams({ q: term, pageSize: "6" })}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { items: Hit[] };
        if (id === seq.current) setState({ kind: "done", items: body.items });
      } catch (e) {
        if ((e as Error).name !== "AbortError" && id === seq.current) setState({ kind: "error" });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  const go = (href: string) => { onOpenChange(false); setQ(""); router.push(href); };
  const items = state.kind === "done" ? state.items : [];
  const term = q.trim();
  const status = state.kind === "loading" ? t("palette.searching")
    : state.kind === "error" ? t("palette.error")
    : state.kind === "done" ? (items.length ? t("palette.results", { count: items.length }) : t("palette.noResults"))
    : "";

  return (
    <DialogRoot open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
      <DialogContent closeLabel={t("palette.close")} className="top-[20%] max-w-xl -translate-y-0 p-0" data-testid="command-palette">
        <DialogTitle className="sr-only">{t("palette.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("palette.description")}</DialogDescription>
        <Command shouldFilter={false} label={t("palette.title")} className="border-0 bg-transparent">
          <CommandInput value={q} onValueChange={setQ} placeholder={t("palette.placeholder")} maxLength={100} className="pr-10" />
          <p role="status" aria-live="polite" className="sr-only" data-testid="palette-status">{status}</p>
          <CommandList>
            {state.kind === "idle" && <p className="p-4 text-center text-sm text-text-muted">{t("palette.hint")}</p>}
            {state.kind === "loading" && <p aria-hidden="true" className="p-4 text-center text-sm text-text-muted">{t("palette.searching")}</p>}
            {state.kind === "error" && <p className="p-4 text-center text-sm text-danger">{t("palette.error")}</p>}
            {state.kind === "done" && items.length === 0 && <CommandEmpty>{t("palette.empty", { q: term })}</CommandEmpty>}
            {items.length > 0 && (
              <CommandGroup heading={t("palette.group")}>
                {items.map((p) => {
                  const avg = Number(p.ratingAverage);
                  return (
                    <CommandItem key={p.id} value={p.id} onSelect={() => go(`/products/${p.slug}`)} className="gap-3 py-1.5">
                      <span className="w-10 shrink-0"><ProductThumb name={p.name} image={p.primaryImage} sizes="40px" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-sm text-text-muted">{p.category.name}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-text-muted">
                        {p.ratingCount > 0 ? <><span aria-hidden="true" className="text-star">★</span> {avg.toFixed(1)}<span className="sr-only">{t("palette.ratingMeta", { rating: avg.toFixed(1), count: p.ratingCount })}</span></> : t("palette.noRatings")}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {items.length > 0 && (
              <CommandGroup>
                <CommandItem value="__all" onSelect={() => go(`/products?${new URLSearchParams({ q: term })}`)} className="text-link">{t("palette.viewAll", { q: term })}</CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </DialogRoot>
  );
}
