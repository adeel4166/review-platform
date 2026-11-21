import Link from "next/link";
import { t } from "@/i18n/en";

const link = "inline-flex min-h-target min-w-target items-center justify-center rounded-md border border-border px-3 text-link hover:bg-bg-subtle";

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <nav aria-label={t("pagination.label")} className="mt-6 flex flex-wrap items-center gap-2">
      {page > 1 && <Link className={link} href={href(page - 1)} rel="prev">{t("pagination.prev")}</Link>}
      <ul className="flex flex-wrap gap-2">
        {nums.map((n, i) => (
          <li key={n} className="flex items-center gap-2">
            {i > 0 && nums[i - 1] !== n - 1 && <span aria-hidden="true">…</span>}
            {n === page ? (
              <span aria-current="page" className="inline-flex min-h-target min-w-target items-center justify-center rounded-md bg-primary px-3 text-on-primary">
                <span className="sr-only">{t("pagination.page", { page: n })}</span><span aria-hidden="true">{n}</span>
              </span>
            ) : (
              <Link className={link} href={href(n)} aria-label={t("pagination.page", { page: n })}>{n}</Link>
            )}
          </li>
        ))}
      </ul>
      {page < pages && <Link className={link} href={href(page + 1)} rel="next">{t("pagination.next")}</Link>}
      <p className="sr-only" role="status">{t("pagination.status", { page, pages })}</p>
    </nav>
  );
}
