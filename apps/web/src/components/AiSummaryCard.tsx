"use client";

import { useId, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { t } from "@/i18n/en";

export interface AiSummaryData { pros: string[]; cons: string[]; overview: string; sourceReviewCount: number }

/**
 * V3-07 AI summary card. Hidden entirely when there is no (READY, flag-enabled) summary. The "AI-generated from N verified reviews"
 * label is always visible, also while collapsed; pros/cons are text lists with +/− glyphs (never colour alone).
 */
export function AiSummaryCard({ summary }: { summary: AiSummaryData | null | undefined }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!summary || (summary.pros.length === 0 && summary.cons.length === 0 && !summary.overview)) return null;
  const label = summary.sourceReviewCount === 1 ? t("aiSummary.labelOne") : t("aiSummary.label", { count: summary.sourceReviewCount });
  return (
    <section aria-labelledby="ai-summary-h" data-testid="ai-summary" className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-sm md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-summary-h" className="text-xl font-semibold">{t("aiSummary.title")}</h2>
        <span data-testid="ai-summary-label" className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2.5 py-0.5 text-sm font-medium text-on-primary-subtle">
          <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />{label}
        </span>
      </div>
      <p className="mt-3 max-w-reading">{summary.overview}</p>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}
        className="mt-3 inline-flex min-h-target items-center gap-1 rounded-md px-2 font-medium text-link hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-focus outline-hidden">
        {open ? t("aiSummary.collapse") : t("aiSummary.expand")}
        <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>
      <div id={panelId} hidden={!open} className="mt-2 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">{t("aiSummary.pros")}</h3>
          <ul className="mt-1 space-y-1">{summary.pros.map((p, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="font-bold text-success">+</span><span>{p}</span></li>)}</ul>
        </div>
        <div>
          <h3 className="font-semibold">{t("aiSummary.cons")}</h3>
          <ul className="mt-1 space-y-1">{summary.cons.map((c, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="font-bold text-danger">−</span><span>{c}</span></li>)}</ul>
        </div>
        <p className="text-sm text-text-muted md:col-span-2">{t("aiSummary.disclaimer")}</p>
      </div>
    </section>
  );
}
