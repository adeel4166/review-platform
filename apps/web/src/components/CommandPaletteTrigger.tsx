"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { t } from "@/i18n/en";

/** Palette code is only fetched on first open (button, Cmd/Ctrl+K); the header carries just this tiny trigger. */
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });

export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLoaded(true);
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" aria-label={t("palette.open")} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" data-testid="palette-trigger"
        onClick={() => { setLoaded(true); setOpen(true); }}
        className="inline-flex min-h-target min-w-target items-center justify-center gap-2 rounded-md px-2 hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-focus outline-hidden">
        <Search size={20} strokeWidth={1.5} aria-hidden="true" />
        <kbd aria-hidden="true" className="hidden rounded border border-border px-1.5 text-xs text-text-muted lg:inline">Ctrl K</kbd>
      </button>
      {loaded && <CommandPalette open={open} onOpenChange={setOpen} />}
    </>
  );
}
