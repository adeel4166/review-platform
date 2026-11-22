"use client";

import dynamic from "next/dynamic";
import { t } from "@/i18n/en";

/** Charts are below the fold: code-split and client-only so they never weigh on the initial product-page bundle. */
const Charts = dynamic(() => import("./ProductCharts"), {
  ssr: false,
  loading: () => <p role="status" className="text-text-muted">{t("charts.loading")}</p>,
});

export function ProductChartsLazy(props: { histogram: unknown; count: number; avg: number | null; verifiedAvg: number | null; verifiedCount: number }) {
  return <Charts {...props} />;
}
